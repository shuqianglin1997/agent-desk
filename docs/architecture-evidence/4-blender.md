# Blender architecture: maintainability mechanisms (from source)

Paths are under source/blender/ in github.com/blender/blender (main). "General knowledge" marks anything I did not see in a fetched file.

## 1. Layered modules with one-way dependencies
1. The code is split into directories ordered by level: blenlib (containers, math), blenkernel (data manipulation, "no tools or UI stuff"), blenloader, depsgraph, makesdna/makesrna, windowmanager, editors, with `creator/` holding only `main()`.
2. Where: handbook page "Source Code Layout" (directory table). The rule that low levels never call up is the "bad level call" rule; I did NOT find or read that handbook page, so its details are general knowledge. Visible evidence: blenkernel headers (BKE_undo_system.hh) take only an opaque `bContext` and function pointers; UI/editor behavior is injected by callbacks, e.g. `DEG_editors_set_update_cb(...)` in DEG_depsgraph.hh.
3. Prevents: cycles, and domain code that cannot be tested or reused without the UI.
4. Transfer: make src/ folders `core/` (pure: scan, profile model, run state; no `electron` import), `services/` (supervisor), `main/` (windows, IPC wiring), `cli/`. Add a lint/test rule that `core/` and `services/` never require `electron` or `ipcMain`. Layer-up needs go through registered callbacks.

## 2. DNA: data layout defined once, parsed by a tool
1. Plain structs in `makesdna/DNA_*.h` are the persisted data; the `makesdna` tool scans them and emits a compact type/offset table (SDNA) so file reading is a mostly binary mapping.
2. Where: `makesdna/intern/makesdna.cc` (header comment: "scans all structs that need to be serialized ... names and types of all members ... offsets"); `makesdna/DNA_ID.h` (`struct ID`, `IDProperty`). Runtime-only fields are labelled in the struct, e.g. `int tag` documented "runtime only, cleared at read time".
3. Prevents: hand-written save/load code drifting from the structs; persisted vs. runtime state getting mixed.
4. Transfer: one schema module (JSON Schema or zod) per persisted file (profiles, run records, settings) from which loaders, validators, CLI output and renderer types derive. Mark runtime-only fields explicitly and strip them on save.

## 3. Migration in one place, keyed by version numbers
1. Each file carries `versionfile`/`subversionfile` (and min versions); loading runs an ordered ladder of "if older than X, fix" steps.
2. Where: `blenkernel/BKE_main.hh` (`Main::versionfile`, `subversionfile`, `minversionfile`); `blenloader/intern/versioning_400.cc`: `blo_do_versions_400(...)` with chains like `if (!MAIN_VERSION_FILE_ATLEAST(bmain, 400, 2)) { for (Mesh &mesh : bmain->meshes) BKE_mesh_legacy_bevel_weight_to_generic(&mesh); }`, plus `do_versions_after_linking_400` for steps needing resolved links; `versioning_defaults.cc` for startup-file defaults. One file per major version.
3. Prevents: compatibility `if`s scattered through feature code; unknowable data shapes.
4. Transfer: store `schemaVersion` in every JSON file; a single `migrations/` array of `{from, up()}` run once at load before anything else sees the data; feature code only ever sees the latest shape. Keep a "refuse files newer than me" guard (min-version fields are the analogue).

## 4. RNA: every property described once, reused everywhere
1. RNA is a reflection layer: each exposed property is declared with type, range, default, description and a change-notification flag; UI, Python, animation and keymap consumers all use that description.
2. Where: `makesrna/RNA_define.hh` (`RNA_def_struct`, `RNA_def_int`, `RNA_def_string`, `RNA_def_enum`, `RNA_def_function`, `RNA_def_property_update(prop, noteflag, updatefunc)`); `makesrna/intern/makesrna.cc` generates accessor code; `RNA_types.hh`.
3. Prevents: the same field being validated/labelled/exposed differently in UI, scripting, and persistence.
4. Transfer: define each operation's and setting's parameters once (name, type, bounds, help text, "changes what" tag) in a registry; derive IPC argument validation, CLI `--help`/`capabilities` output and renderer form fields from it.

## 5. Operator registry: all actions through one door
1. A user action is a `wmOperatorType` with id, `poll` (may it run now), `exec` (no interaction), `invoke` (start from an event), `modal`, `cancel`, and flags. Menus, keys and scripts all call by `idname`.
2. Where: `windowmanager/WM_types.hh` `struct wmOperatorType` (`idname`, `exec`, `invoke`, `cancel`, `modal`, `poll`, `poll_property`, `ui`; `OPTYPE_UNDO`/`OPTYPE_REGISTER` flags); `WM_api.hh`: `WM_operatortype_append`, `WM_operatortype_find`, `WM_operator_poll`, `WM_operator_call_py`. `wm_operators.cc` pushes undo after run if flagged (`ED_undo_push_op`, ~line 1409).
3. Prevents: duplicate logic per entry point; actions that bypass availability checks or history.
4. Transfer: `operations/registry.js` with `{id, poll(ctx), run(ctx,args), argsSchema, mutates}`. IPC handlers are a single generic `invoke(opId,args)` that calls poll then run; the CLI calls the same registry. This also gives the narrow IPC bridge a fixed surface: one channel, ids from the registry.

## 6. Notifiers and listeners instead of polling
1. Code that changes state posts a small typed notifier (category/data/subtype/action packed in one uint); the window manager dedupes and delivers to each editor's `listener`, which tags what to redraw.
2. Where: `WM_types.hh` `struct wmNotifier {window, category, data, subtype, action, reference}` and `NC_*` masks; `wm_event_system.cc`: `WM_event_add_notifier(C, type, ref)`, `wm_event_add_notifier_intern` (a `notifier_queue_set` hash drops duplicate notifiers), `wm_event_do_notifiers` which dispatches via `ED_area_do_listen`/`ED_region_do_listen`; `WM_main_remove_notifier_reference` drops notifiers for freed objects.
3. Prevents: producers knowing consumers; redundant redraws; stale events pointing at deleted data.
4. Transfer: main-process `changes.emit({kind:'runs', id})` into a coalescing queue (flush per tick), forwarded as one `state-changed` IPC event with kind tags; renderer panels subscribe by kind and refetch. Drop queued events for a deleted run/profile.

## 7. Dependency graph: tag what changed, recompute only that
1. Editing code does not recompute; it tags the datablock with what changed (`recalc` flags), and the depsgraph later re-evaluates only affected nodes, on a copy of data ("copy-on-evaluation", per the handbook/general knowledge; I did not open that code).
2. Where: `depsgraph/DEG_depsgraph.hh`: `DEG_id_tag_update(id, flags)`, `DEG_graph_time_tag_update`, `DEG_evaluate_on_refresh`, `DEG_ids_clear_recalc`; `DNA_ID.h` `ID::recalc`, `recalc_after_undo_push`.
3. Prevents: "refresh everything" and ordering bugs between derived data.
4. Transfer (scaled down): keep a `dirty` set per domain (profiles, scan results, run list). A scan marks a profile dirty with a reason; a single `flush()` rebuilds only derived views (roster, capabilities) for dirty ids. Do not build a graph.

## 8. Datablocks with ownership and user counts
1. Everything persistent is an `ID` with unique name per type, owned by a `Main` database in typed lists; references increment `us`, and deletion goes through central functions.
2. Where: `BKE_main.hh` (`struct Main`, `ListBaseT<Scene> scenes`, `ListBaseT<Object> objects`...); `DNA_ID.h` (`ID::name` with type code in first 2 bytes, `us`, `ID_REAL_USERS`, `ID_FAKE_USERS`, `session_uid`); `BKE_lib_id.hh` (`BKE_id_new`, `BKE_id_delete`, `id_us_ensure_real`).
3. Prevents: dangling references and leaks; ad hoc deletion.
4. Transfer: one `Store` owning profiles/runs by stable id with `create/remove` only through it; `remove` refuses (or cascades) if a run references the profile. Typed id prefixes (`profile:`, `run:`) make a wrong-kind id fail early.

## 9. Undo as pluggable step types
1. Each kind of state registers an `UndoType` that encodes/decodes its own step, with a shared stack, memory/step limits and grouping.
2. Where: `blenkernel/BKE_undo_system.hh` `struct UndoType {poll, step_encode, step_decode, step_free}`, `struct UndoStep`, `BKE_undosys_stack_limit_steps_and_memory`, `BKE_undosys_stack_group_begin/end`.
3. Prevents: one global snapshot scheme that cannot fit special modes.
4. Transfer: only if you need reversible actions. Cheap version: operations declare `inverse(args, before)`; keep a bounded stack for settings edits. Do not apply to process runs.

## 10. Reports as the error channel
1. Operators return status and add user-facing messages to a `ReportList` rather than printing or throwing; the caller (UI, console, script) decides display. Where: `blenkernel/BKE_report.hh` (`ReportList`, `ReportListFlags`, a flag to not print because the owner handles it) — I read only the header's top, so semantics are partial.
2. Transfer: every operation returns `{status, reports:[{code, severity}]}`; GUI shows toasts, CLI prints and sets the exit code. Matches the "fixed reason codes only" error policy.

## Do NOT copy
- Generated C struct tables and binary file-format mapping (makesdna/makesrna code generators): use JSON + schema validation.
- Per-type `ListBase` main database, manual refcounts, library linking and overrides.
- Full depsgraph with copy-on-evaluation; a dirty set is enough.
- Packed uint notifier bitmasks and macros; use string/enum kinds.
- Modal operators, macro operators and the event-state machine unless you have drag interactions.
- Undo for external side effects, and a Python-style scripting API layer (the CLI is the script surface).

## URLs actually read (all fetched, HTTP 200)
- https://raw.githubusercontent.com/blender/blender/main/source/blender/ : makesdna/DNA_ID.h, makesdna/intern/makesdna.cc, makesrna/RNA_define.hh, makesrna/RNA_types.hh, makesrna/intern/makesrna.cc, blenkernel/BKE_main.hh, blenkernel/BKE_lib_id.hh, blenkernel/BKE_undo_system.hh, blenkernel/BKE_report.hh, depsgraph/DEG_depsgraph.hh, windowmanager/WM_types.hh, windowmanager/WM_api.hh, windowmanager/intern/wm_event_system.cc, windowmanager/intern/wm_operators.cc, blenloader/intern/versioning_400.cc, blenloader/intern/versioning_defaults.cc, blenkernel/intern/lib_id_delete.cc and undo_system.cc (downloaded, only skimmed/not used).
- https://developer.blender.org/docs/features/code_layout/ (directory table read; its module diagram not viewable).
- Not found: https://developer.blender.org/docs/handbook/guidelines/blend_file_compatibility/ (404). The "bad level calls" and "Main database" handbook pages were not read.
