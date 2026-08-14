#!/usr/bin/env bash

set -euo pipefail

for required_name in GH_TOKEN GH_REPO RELEASE_TAG RELEASE_ID EXPECTED_ASSET_IDENTITY; do
  if [ -z "${!required_name:-}" ]; then
    echo "::error::$required_name is required for release rollback."
    exit 1
  fi
done

if [[ ! "$GH_REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo '::error::GH_REPO must be an owner/repository identifier.'
  exit 1
fi
if [[ ! "$RELEASE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-preview\.[0-9A-Za-z][0-9A-Za-z.-]*$ ]]; then
  echo '::error::RELEASE_TAG must identify a Preview candidate.'
  exit 1
fi
if [[ ! "$RELEASE_ID" =~ ^[0-9]+$ ]]; then
  echo '::error::RELEASE_ID must be the numeric ID captured when the Draft was created.'
  exit 1
fi

publicly_exposed="${PUBLICLY_EXPOSED:-false}"
if [ "$publicly_exposed" != "true" ] && [ "$publicly_exposed" != "false" ]; then
  echo '::error::PUBLICLY_EXPOSED must be true or false.'
  exit 1
fi

rollback_trigger="${ROLLBACK_TRIGGER:-release transaction failure}"
summary_path="${GITHUB_STEP_SUMMARY:-/dev/null}"
candidate_burned="$publicly_exposed"
declare -a drift_reasons=()
declare -a rollback_ids=()

add_reason() {
  local reason="$1"
  local existing
  for existing in "${drift_reasons[@]:-}"; do
    if [ "$existing" = "$reason" ]; then
      return
    fi
  done
  drift_reasons+=("$reason")
}

add_rollback_id() {
  local release_id="$1"
  local existing
  for existing in "${rollback_ids[@]:-}"; do
    if [ "$existing" = "$release_id" ]; then
      return
    fi
  done
  rollback_ids+=("$release_id")
}

release_exists() {
  local release_id="$1"
  gh api "repos/$GH_REPO/releases/$release_id" >/dev/null 2>&1
}

redraft_release() {
  local release_id="$1"
  gh api --method PATCH "repos/$GH_REPO/releases/$release_id" \
    -F draft=true \
    -F prerelease=true >/dev/null
}

assert_redrafted_release() {
  local release_id="$1"
  local state
  state="$(gh api "repos/$GH_REPO/releases/$release_id" --jq '[.id, .draft, .prerelease] | @tsv')"
  if [ "$state" != "$(printf '%s\ttrue\ttrue' "$release_id")" ]; then
    echo "::error::Emergency rollback could not prove that release ID $release_id returned to Preview draft state."
    exit 1
  fi
}

mark_release_burned() {
  local release_id="$1"
  local notice current_body updated_body
  notice="PUBLIC VERIFICATION FAILED — CANDIDATE BURNED. Do not republish, overwrite, or reuse tag $RELEASE_TAG or its version."
  current_body="$(gh api "repos/$GH_REPO/releases/$release_id" --jq '.body // ""')"
  if [[ "$current_body" != *"$notice"* ]]; then
    updated_body="$(printf '%s\n\n%s' "$notice" "$current_body")"
    jq -n --arg body "$updated_body" '{body: $body, draft: true, prerelease: true}' |
      gh api --method PATCH "repos/$GH_REPO/releases/$release_id" --input - >/dev/null
  fi
}

if [ "$publicly_exposed" = "true" ]; then
  add_reason 'the candidate passed through the public publication boundary'
fi

# Re-read the same-tag identity after each patch. A concurrent ID swap cannot
# leave the new same-tag owner public, and every observed release is rolled back.
stable_same_tag_id=''
for attempt in 1 2 3; do
  if ! before="$(gh api "repos/$GH_REPO/releases/tags/$RELEASE_TAG")"; then
    candidate_burned=true
    add_reason 'the same-tag release lookup failed'
    known_release_recovered=false
    if release_exists "$RELEASE_ID"; then
      add_rollback_id "$RELEASE_ID"
      redraft_release "$RELEASE_ID"
      assert_redrafted_release "$RELEASE_ID"
      mark_release_burned "$RELEASE_ID"
      assert_redrafted_release "$RELEASE_ID"
      known_release_recovered=true
    fi
    echo "::error::The current same-tag release cannot be found. Candidate $RELEASE_TAG is burned and requires manual incident review."
    {
      echo '## Emergency rollback could not locate the same-tag release'
      echo
      if [ "$known_release_recovered" = "true" ]; then
        echo "The captured release ID $RELEASE_ID was returned to Draft and marked burned, but the current same-tag identity could not be proven."
      else
        echo "Neither the same-tag release nor captured release ID $RELEASE_ID could be recovered automatically."
      fi
      echo "$RELEASE_TAG is burned. Do not recreate or reuse it; inspect GitHub audit history and any previously published release ID."
    } >> "$summary_path"
    exit 1
  fi

  current_release_id="$(jq -r .id <<<"$before")"
  if [[ ! "$current_release_id" =~ ^[0-9]+$ ]]; then
    echo '::error::The same-tag GitHub Release did not have a numeric release ID.'
    exit 1
  fi
  add_rollback_id "$current_release_id"

  was_draft="$(jq -r .draft <<<"$before")"
  published_at="$(jq -r '.published_at // empty' <<<"$before")"
  actual_asset_identity="$(jq -r '[.assets[] | [.name, (.id | tostring), (.size | tostring), .state] | join(":")] | sort | join("|")' <<<"$before")"
  if [ "$was_draft" != "true" ] || [ -n "$published_at" ]; then
    candidate_burned=true
    add_reason 'the candidate was publicly exposed'
  fi
  if [ "$current_release_id" != "$RELEASE_ID" ]; then
    candidate_burned=true
    add_reason "the same tag moved from release ID $RELEASE_ID to $current_release_id"
  fi
  if [ "$actual_asset_identity" != "$EXPECTED_ASSET_IDENTITY" ]; then
    candidate_burned=true
    add_reason 'the same-tag release asset identity changed'
  fi

  redraft_release "$current_release_id"

  after="$(gh api "repos/$GH_REPO/releases/tags/$RELEASE_TAG")"
  after_release_id="$(jq -r .id <<<"$after")"
  after_asset_identity="$(jq -r '[.assets[] | [.name, (.id | tostring), (.size | tostring), .state] | join(":")] | sort | join("|")' <<<"$after")"
  if [ "$after_asset_identity" != "$EXPECTED_ASSET_IDENTITY" ]; then
    candidate_burned=true
    add_reason 'the same-tag release asset identity changed during rollback'
  fi
  if [ "$after_release_id" = "$current_release_id" ]; then
    stable_same_tag_id="$current_release_id"
    break
  fi

  candidate_burned=true
  add_reason "the same tag moved during rollback from release ID $current_release_id to $after_release_id"
done

if [ -z "$stable_same_tag_id" ]; then
  echo '::error::The same-tag release identity did not remain stable long enough to prove rollback.'
  exit 1
fi

# If the original verified ID moved to another tag, return that object to Draft
# too. Its absence is an incident signal, but the current same-tag owner still
# gets rolled back and permanently burned.
if [ "$stable_same_tag_id" != "$RELEASE_ID" ]; then
  if release_exists "$RELEASE_ID"; then
    add_rollback_id "$RELEASE_ID"
    redraft_release "$RELEASE_ID"
  else
    candidate_burned=true
    add_reason "the originally verified release ID $RELEASE_ID no longer exists"
  fi
fi

for release_id in "${rollback_ids[@]}"; do
  assert_redrafted_release "$release_id"
done

same_tag_final="$(gh api "repos/$GH_REPO/releases/tags/$RELEASE_TAG")"
same_tag_state="$(jq -r '[.tag_name, .id, .draft, .prerelease] | @tsv' <<<"$same_tag_final")"
expected_same_tag_state="$(printf '%s\t%s\ttrue\ttrue' "$RELEASE_TAG" "$stable_same_tag_id")"
if [ "$same_tag_state" != "$expected_same_tag_state" ]; then
  echo '::error::Emergency rollback could not prove the same-tag Release is the expected Preview draft.'
  exit 1
fi
final_asset_identity="$(jq -r '[.assets[] | [.name, (.id | tostring), (.size | tostring), .state] | join(":")] | sort | join("|")' <<<"$same_tag_final")"
if [ "$final_asset_identity" != "$EXPECTED_ASSET_IDENTITY" ]; then
  candidate_burned=true
  add_reason 'the same-tag release asset identity differed after rollback'
fi

if [ "$candidate_burned" = "true" ]; then
  for release_id in "${rollback_ids[@]}"; do
    mark_release_burned "$release_id"
    assert_redrafted_release "$release_id"
  done
  reason_text="$(IFS='; '; printf '%s' "${drift_reasons[*]:-public exposure cannot be disproved}")"
  notice="PUBLIC VERIFICATION FAILED — CANDIDATE BURNED. Do not republish, overwrite, or reuse tag $RELEASE_TAG or its version."
  echo "::error::$notice"
  {
    echo '## Release rolled back; candidate burned'
    echo
    echo "- Trigger: $rollback_trigger"
    echo "- Evidence: $reason_text"
    echo "- $RELEASE_TAG and its version must never be reused."
  } >> "$summary_path"
else
  echo '::error::Draft validation/publication failed before verified public exposure; the release remains a draft.'
  {
    echo '## Release transaction returned to Draft'
    echo
    echo "- Trigger: $rollback_trigger"
    echo '- Public exposure was not observed; immutable candidate non-reuse rules still apply to any later retry decision.'
  } >> "$summary_path"
fi
