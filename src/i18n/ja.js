/* AgentDesk locale · 日本語（キーは zh.js に対応）。 */
(function (root) {
  const L = root.AgentDeskLocales || (root.AgentDeskLocales = {});
  L.ja = {
    meta: { label: '日本語' },

    // トップバー
    'app.tagline': 'AGENT WORKSPACE',
    'topbar.context.yard': 'にゃんこ庭 · ローカルのアカウントとセッション',
    'topbar.context.classic': 'クラシック · ローカルのアカウントとセッション',
    'topbar.leaderboard': 'ランク',
    'topbar.update': '更新',
    'topbar.toClassic': 'クラシック',
    'topbar.toYard': '庭',
    'topbar.connect': '接続',
    'topbar.leaderboard.title': 'アカウント別・本日の作業量ランキング',
    'topbar.update.title': 'GitHub の更新を確認',
    'topbar.view.title': 'にゃんこ庭 / クラシック 表示を切り替え',
    'topbar.connect.title': 'エージェント種別の接続 / 管理（自動検出 + カスタム追加）',
    'topbar.help.title': '使い方',
    'topbar.theme.title': 'ダーク / ライト を切り替え',
    'topbar.lang.title': '表示言語を切り替え（中 / EN / 日）',

    // にゃんこ庭・雰囲気
    'yard.atmos.time': '時間',
    'yard.atmos.weather': '天気',
    'yard.time.auto': '追従',
    'yard.time.day': '昼',
    'yard.time.dusk': '夕方',
    'yard.time.night': '夜',
    'yard.weather.title': '天気',
    'yard.weather.auto': '自動',
    'yard.weather.clear': '晴れ',
    'yard.weather.cloudy': '曇り',
    'yard.weather.rain': '雨',
    'yard.weather.snow': '雪',

    // 今日の記録 / リマインド
    'ledger.title': '今日の記録',
    'ledger.done': '{n} 回 完了',
    'ledger.min': '{n} 分 いっしょに',
    'reminder.on': '🔔 リマインド オン',
    'reminder.off': '🔔 リマインド オフ',
    'reminder.title': '休憩リマインド（ストレッチ / 終業のお知らせ）',

    // アカウント操作バー
    'account.none': 'アカウント未選択',
    'account.form': '形態',
    'account.form.title': 'このアカウントには複数のクライアント形態があります。切り替えると 開く / 編集 / 削除 / 診断 / パス / クォータ が選択した形態に適用されます',
    'account.open': 'アカウントを開く',
    'account.add': '追加',
    'account.path': 'パス',
    'account.diagnostics': '診断',
    'account.refresh': '更新',
    'account.manage': '管理',
    'account.edit': '編集',
    'account.remove': '削除',
    'account.folder': '場所',
    'quota.self': '自分',
    'quota.all': '全体',
    'quota.self.title': 'このアカウントのクォータ · クリックで詳細',
    'quota.all.title': '全アカウントのクォータ · クリックで一覧',
    'quota.kicker': 'クォータ Beta',
    'quota.waiting': '待機中',
    'quota.refresh': '↻ クォータ更新',
    'quota.refresh.title': '公式サービスからクォータを更新',

    // 要確認 / クォータ一覧
    'attention.kicker': 'ATTENTION',
    'attention.title': '要確認',
    'quotaMap.kicker': 'QUOTA MAP',
    'quotaMap.title': '全体のクォータ',

    // セッション表
    'session.title': 'セッション',
    'session.count': '{n} 件',
    'session.search': 'タイトル・プロジェクト・ID で検索',
    'session.col.title': 'タイトル',
    'session.col.active': '最終',
    'session.col.project': 'プロジェクト',
    'session.col.source': 'ソース',
    'session.empty.filtered': '一致するセッションがありません。別のキーワードでお試しください。',
    'session.empty.none': 'このアカウントにはまだセッションがありません。「アカウントを開く」で公式アプリにログインし、利用するとここに自動で表示されます。読み込めない場合は「診断」を。',

    // セッション詳細
    'detail.title': 'セッション詳細',
    'detail.field.title': 'タイトル',
    'detail.field.thread': 'スレッド ID',
    'detail.field.created': '作成',
    'detail.field.active': '最終',
    'detail.field.source': 'ソース',
    'detail.field.project': 'プロジェクト',
    'detail.field.file': 'ファイル',
    'detail.field.address': 'セッション ID',
    'detail.copyHandoff': '引き継ぎをコピー',
    'detail.copyAddress': 'ID をコピー',
    'detail.copyProject': 'プロジェクトをコピー',
    'detail.reveal': '場所を開く',
    'detail.exportMd': 'Markdown で書き出し',
    'detail.export.can': 'この会話を Markdown ファイルに書き出す',
    'detail.export.cannot': 'このクライアントはまだ Markdown 書き出しに対応していません',

    // 引き継ぎテキスト（クリップボードにコピー）
    'handoff.template': `このセッションの続きを理解する手助けをしてください：

アプリ：{app}
アカウント枠：{slot}
タイトル：{title}
作成日時：{created}
最終アクティブ：{active}
ソース：{source}
状態：{status}
プロジェクト：{project}
セッション ID：{address}
セッションファイル：{file}
スレッド ID：{thread}

これらの情報から、このセッションが何をしているか判断し、続けてください。`,

    // ステータスバー
    'status.ready': '準備完了',
    'status.today': '今日 · {done} 回 · {min} 分',
    'status.attention': '要確認 {n} 件',
    'common.unrecorded': '記録なし',

    // 動的テキスト（renderer / scene 実行時に tr）
    'state.confused': '迷子',
    'state.working': '作業中',
    'state.onduty': '待機',
    'state.arriving': '起動中',
    'state.play': '遊び中',
    'state.rest': 'ごろ寝',
    'state.nap': 'うたた寝',
    'state.hibernate': '冬眠',
    'energy.fresh': '元気',
    'energy.steady': '安定',
    'energy.tired': 'お疲れ',
    'energy.exhausted': '残量わずか',
    'energy.unknown': '不明',
    'ctx.yard': 'にゃんこ庭',
    'ctx.classic': 'クラシック',
    'ctx.noAccount': 'アカウント未選択',
    'acct.slotDefault': '既定の枠',
    'acct.slotIndependent': '独立した枠',
    'acct.lastOpen': '最終起動 {t}',
    'acct.badgeParallel': '⌨ {n} 並行',
    'acct.badgeForms': '⛓ {n} 形態',
    'acct.tip': 'アカウント {p} · セッション {s}',
    'acct.note': 'メモ: {note}',
    'detail.unselected': '未選択',
    'card.busy': '{n} 件のセッションが進行中',
    'card.forms': '1 アカウント {n} 形態',
    'card.group': 'グループ · {g}'
  };
})(typeof self !== 'undefined' ? self : this);
