import SwiftUI

struct PanelInfoView: View {

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("点击底栏的 ⓘ 或设置图标切换内容，再点已选中的图标返回账号列表。").foregroundStyle(.secondary)
            Text("账号与对话").fontWeight(.semibold)
            Text("添加 Codex 或 Claude 账号，点击“启动 / 前台”打开对应客户端。点击对话会调出所属账号；具体对话可能需要在客户端里选择。")
            Text("分组与排序").fontWeight(.semibold)
            Text("点击客户端分组收起或展开，拖动分组或账号调整顺序。右键账号可以改名或删除。额度旁显示重置时间。")
            Text("额度与缓存标志").fontWeight(.semibold)
            Text("百分比表示已用额度，悬停可看剩余比例。打开面板会同步额度，账号旁的刷新按钮可立即重试；设置中可开关每 5 分钟的后台同步。Claude 查询使用对应客户端的登录授权，不保存到 AgentDesk Native 文件或日志；首次手动刷新可能需要允许钥匙串访问。")
            Text("“缓存 · 5 小时前”表示记录距今多久，不是剩余额度或重置倒计时。实时查询失败时保留旧值，悬停警示可看原因；旧记录无法确认当前用量时显示“待更新”。")
            Text("文档接力").fontWeight(.semibold)
            Text("先停下原任务，右键对话 →“接力到…”。选择已准备好的 Markdown 交接文档，AgentDesk Native 保存副本、复制正文和绝对路径，再打开目标账号。请新建对话，粘贴并发送；原对话不会自动复制。")
            Text("可选桌宠").fontWeight(.semibold)
            Text("桌宠能力默认关闭。在设置中开启后，爪印按钮控制静态浮球显示与隐藏。单击打开面板，双击调出忙碌账号，拖动换位置，右键打开菜单。面板始终使用 macOS 原生外观。")
        }
        .font(.system(size: 11))
        .fixedSize(horizontal: false, vertical: true)
    }
}
