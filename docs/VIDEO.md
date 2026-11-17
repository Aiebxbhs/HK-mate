# 介绍视频与 README 截图

中英两版介绍视频和 README 里的截图都由 `video/` 下的脚本生成，可以随时重做。成片和中间文件在 `video/out/`，不进 Git。

## 成片

| 文件 | 内容 |
|---|---|
| `video/out/hk-mate-intro.mp4` | 中文版，约 5 分 11 秒，1920×1080，带配乐 |
| `video/out/hk-mate-intro-en.mp4` | 英文版，约 5 分 21 秒 |
| 同名 `-silent.mp4` | 无声原片，换配乐时用 |

## 重新生成

需要 Ollama 在运行、前端已构建（`npm --prefix frontend run build`），每版约 8 分钟。

```bash
bash video/make.sh                                    # 中文版；英文版加 --lang=en
bash video/soundtrack.sh video/out/hk-mate-intro.mp4 A 2   # 配乐：片头 A、正片 2 号
node video/record.mjs --stills                        # 只截干净的整页截图到 video/out/stills/（英文加 --lang=en）
bash video/open_demo.sh                               # 重新打开演示环境查看，保留上次的数据
```

助手的回答和餐厅结果当场生成，每次重录会有差别；会消耗少量云端模型和 Google 地图额度。

## 怎么做出来的

不是手工录屏。`video/demo_server.py` 在 8010 端口起一个演示实例（临时数据库、演示账号），`video/record.mjs` 用无头 Chrome 打开导演页面（`video/director/`）：页面里嵌着真实的应用，按分镜点击、输入，并叠加缩放镜头、鼠标指针、底部短字和菜单名；等待模型的片段按 4–8 倍速压缩（`timeline.mjs`），再用系统自带的编码器输出 mp4（`encode.swift`）。没有新增依赖。

- **真实的**：界面和交互；邮件摘要与分类、回复草稿、字幕和译文、课后摘要由本机模型当场生成；助手的回答和餐厅结果来自配置的云端服务和 Google 地图。
- **合成的**：演示账号、邮件都是自己写的；讲课声音是系统语音朗读 `scripts/bench-data/lecture_script.txt`，通过 Chrome 的假麦克风送入。
- **示意的**：片头的问题卡片和“系统通知横幅”是导演页面画的；横幅里的发件人、主题和摘要取自应用的真实数据。
- **课表**：如果存在 `private-data/video-timetable.json`（从本机数据库导出的真实课表，不进 Git），演示里导入的就是它；否则用合成课表。
- **配乐**：`video/music.py` 用 numpy 合成，全部原创，不含任何现成音乐；片头每个问题弹出有音效，标志出现时音乐打开。`mux.swift` 把音轨并入 mp4，不重新编码画面。

## 片子的结构

| 段落 | 内容 |
|---|---|
| 片头 | 六个问题依次弹出，收拢成 HK Mate；一句介绍和五个功能名 |
| 主页 | 接下来 5 天、24 小时内截止的提醒；AI 助手查安排、找餐厅、加日程（确认后才加） |
| 日程 | 助手加的那条已在列表里；手动加一条截止事项；粘贴链接导入整学期课表；回主页看更新 |
| 邮件 | 主页收到新邮件；分邮箱标签、分类和摘要、起草回复 |
| 课堂翻译 | 双语字幕、课堂笔记、课后重点、保存到课程记录 |
| HKU 指南 | 图书馆逐层点击、设施筛选、打印机明细；校园地图；港铁、巴士、穿梭巴士；学生服务 |
| 片尾 | 标志和“留一点时间给生活” |

镜头规则：切换功能时推近真实菜单栏并显示菜单名；点击和等待都在全貌下进行，放大只用来短暂展示结果；鼠标指针只在点击时出现；短字在屏幕正下方居中。分镜写在 `video/director/scenes.js`，镜头和指针在 `lib.js`，英文版的文字用 `L('中文', 'English')` 成对写在分镜旁。

## 文件

| 文件 | 作用 |
|---|---|
| `demo_server.py`、`run_demo.sh`、`reset.sh`、`open_demo.sh` | 演示实例：合成邮箱和数据，启动、重置、保留数据重开 |
| `cdp.mjs`、`record.mjs` | 驱动无头 Chrome 并录制帧（或只截图） |
| `director/` | 导演页面：分镜、镜头、样式 |
| `timeline.mjs`、`encode.swift` | 压缩等待片段，编码成 mp4 |
| `music.py`、`mux.swift`、`duration.swift`、`soundtrack.sh` | 合成配乐并并入视频 |
| `make.sh` | 一条命令录制并编码 |
