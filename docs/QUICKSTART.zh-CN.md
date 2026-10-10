# LaTeX Studio V1.0 使用指南

LaTeX Studio 是单用户、本地优先的论文写作工作台。论文源文件、编译结果和快照都保存在自己的电脑上。首次安装依赖需要联网，安装完成后，编辑器和 PDF 阅读器可离线使用。

## 下载与启动

1. 从 [GitHub 正式版](https://github.com/nanoandluna/latex-studio/releases/latest) 下载 `latex-studio-1.0.0.zip` 并解压。该包包含已经构建好的前后端，不是 Windows 安装程序。
2. 安装 Node.js 22.13 或更高版本。安装 pnpm：`npm install -g pnpm@11.18.0`。
3. Windows 双击 `start.cmd`；macOS/Linux 在终端运行 `sh start.sh`。首次启动会安装运行依赖。
4. 保持启动窗口打开，在浏览器访问 `http://localhost:3210`。

编译需要本地 TeX 环境：Windows 可用 [MiKTeX](https://miktex.org) 或 [TeX Live](https://tug.org/texlive)，macOS/Linux 可用 TeX Live。Windows 使用 latexmk 时需要 Perl。中文论文建议选择 XeLaTeX；使用 biblatex 时需要 Biber。安装后重启启动窗口，再检查环境。

## 写作流程

- 在 Open Workspace 中输入已有项目的完整目录路径，或用 Create 新建模板项目。
- 点击左侧文件树打开文件。`Ctrl+S` 保存当前文件；命令面板的 Save All Files 保存全部编辑内容。
- `Ctrl+B` 先保存全部修改，再编译主文件。保存冲突或失败会阻止这次编译。
- `Ctrl+Shift+P` 打开命令面板；`Ctrl+Shift+F` 搜索全项目。
- `Ctrl+Shift+S` 创建手动快照。快照保存磁盘上的文件；需要把当前草稿纳入快照时，请先保存。
- 在 Navigator 查看论文概览、引用位置、术语一致性和统计。
- PDF 支持搜索、缩略图、阅读位置记忆和双向 SyncTeX 跳转。

## 草稿恢复与保存冲突

未保存草稿会按项目保存在当前浏览器的本地存储中。刷新页面、重开浏览器或切换回来时，编辑器会恢复草稿，并保留未保存标记。恢复不会自动把旧草稿覆盖到论文文件上。

当 Zotero、其他编辑器、快照恢复或批量替换修改了磁盘文件，旧编辑缓冲区的保存会被阻止。点击 **Review disk changes** 查看左右差异，然后选择：

- **Keep editing**：继续编辑草稿。
- **Use disk version**：经确认后放弃当前草稿，加载磁盘版本。
- **Save my version**：明确选择使用当前草稿；保存时仍检查磁盘是否再次变化。

浏览器草稿存储不是独立备份：清除浏览器数据、换浏览器或换访问地址会影响恢复。存储不可用或容量不足时，界面会提示，应及时保存到磁盘。重要稿件仍建议配合项目 ZIP 导出和其他备份。

## 文献与 Zotero

在 Zotero 配合 Better BibTeX，把选定分类自动导出为项目目录中的 `refs.bib`，启用 Keep updated。LaTeX Studio 监测 `.bib` 文件变化，自动刷新引用信息；不会修改 Zotero 数据库或重写文献库。

在 Navigator → Citations 按键、标题、作者、年份或 DOI 搜索文献。打开 `.tex` 文件后，**Insert citation** 在光标处插入 `\cite{key}`；**Copy citation** 复制引用命令；**Open paper** 打开 DOI 或网页。缺失和重复的文献键仍会单独标记。

## 快照和升级

History 可对比和恢复快照。恢复前核验快照文件哈希，并创建 pre-restore 保护快照。已删除的源文件和目录也能恢复；损坏的快照会在写入前被拒绝。恢复过程中发生磁盘错误时，界面会列出失败文件，可以从 pre-restore 快照恢复当前状态。

从 V0.5 升级请看 [升级说明](UPGRADE.md)。
