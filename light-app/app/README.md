# 数学学科师资统计离线查询 App

这是一个纯 Python 标准库实现的本地 HTTP 后端。它只读访问项目最终 SQLite 数据库，并为 `app/static` 中的前端提供 API、报告、导出文件和证据快照。

## 启动

Windows 用户可双击：

```text
启动数学学科师资统计.bat
```

也可以使用 `app/启动数学学科师资统计.bat`。两个启动器使用同一套数据库和服务代码，均优先调用 `app/math-faculty-app.exe`。

启动器优先运行同目录的 `math-faculty-app.exe`，否则依次回退到 `py -3` 和 `python`。窗口会显示实际访问 URL，并在服务停止后保留退出信息。

也可以从项目根目录直接运行：

```powershell
py -3 app/server.py
```

默认监听 `http://127.0.0.1:8766/`。若端口被占用，服务会自动尝试后续端口；正常启动后使用 Python `webbrowser` 模块打开系统默认外部浏览器。

## 参数

```text
--host HOST          监听地址，默认 127.0.0.1
--port PORT          起始端口，默认 8766；占用时自动递增
--database PATH      SQLite 数据库；相对路径以项目根目录为基准
--project-root PATH  项目根目录
--no-browser         不自动打开系统默认浏览器
```

示例：

```powershell
py -3 app/server.py --port 9000 --no-browser
py -3 app/server.py --project-root "D:\math-faculty" --database data\math_faculty.db
```

默认数据库为 `data/math_faculty.db`，完成状态注册表为 `data/exports/全国学校完成状态_2026-07-18.json`。学校详情页不显示饼图和单位报告，教师报告支持关键词、M 分类和 T1-T4 筛选，并显示相关院系边界审计。启动器使用 Windows 默认浏览器打开本地服务；静态证据包通过项目配置外部接入，未配置时只使用官网地址。

## API

所有端点只接受 `GET` 和 `HEAD`，JSON 使用 UTF-8。

| 端点 | 内容 |
| --- | --- |
| `/api/health` | 服务、只读数据库和快照状态 |
| `/api/summary` | 全国总数、T1-T4、M0-M8 和等级汇总 |
| `/api/options` | 学校、等级、完成状态、院系和分类字典 |
| `/api/schools?q=&grade=&status=&sort=` | 127 校指标列表 |
| `/api/schools/{school_id}` | 单校院系、方向、人才、问题与教师报告入口 |
| `/api/faculty?q=&school_id=&unit_id=&direction=&talent=&page=&page_size=` | 按任职记录分页的教师列表 |
| `/api/people/{person_id}?school_id=` | 人员任职、全部单位、方向、人才与来源 |
| `/api/talents?q=&school_id=&tier=&page=&page_size=` | T1-T4 人才记录分页 |
| `/api/compare?school_ids=SCH-...,SCH-...` | 最多 4 校对比 |

`page` 从 1 开始，`page_size` 最大为 100。参数错误、资源不存在和方法不允许均返回明确结构：

```json
{
  "error": {
    "code": "invalid_parameter",
    "message": "page_size 不能超过 100",
    "details": {"parameter": "page_size", "maximum": 100}
  }
}
```

## 静态映射

| URL | 本地目录 |
| --- | --- |
| `/`、`/static/*` | `app/static` |
| `/reports/*` | `reports` |
| `/data/exports/*` | `data/exports` |
| `/evidence/*` | `evidence` |
| `/data/evidence/*` | `data/evidence` |

服务不提供目录列表。所有路径先按 UTF-8 解码，再检查点路径、反斜杠、符号链接和最终解析位置，以阻止路径穿越。HTML、CSS、JavaScript、JSON、CSV、Excel、图片和字体均按对应 MIME 类型返回，并带有缓存与 `nosniff` 响应头。

## 只读保证

每个请求都通过 SQLite URI `mode=ro` 建立独立连接，并执行 `PRAGMA query_only=ON`。所有来自查询参数的 SQL 值使用绑定参数；排序字段仅允许固定白名单。后端不会创建、更新或删除数据库记录。

## PyInstaller onefile

打包运行时，静态资源从 `sys._MEIPASS/static` 读取。未显式指定项目根目录时，程序优先在可执行文件所在目录的父目录和当前目录中寻找 `data/math_faculty.db`，随后兼容可执行文件目录等候选位置。普通 Python 运行仍使用源码目录的 `app/static`。

数据库、导出文件、报告和证据不嵌入 onefile，应与项目目录结构一起交付。

正式窗口版位于 `app/math-faculty-app.exe`，构建参数与 SHA-256 记录在
`app/app_build_manifest.json`。完整发行包保留项目目录结构，因此解压后可直接
双击 `app/启动数学学科师资统计.bat`。

## 测试

从项目根目录运行：

```powershell
py -3 -B -X utf8 -m unittest -v app/test_server.py
```

测试使用真实最终数据库和临时 HTTP 端口，覆盖健康检查、关键总数、筛选、分页、学校与人员详情、人才、校际对比、静态文件、中文路径、路径穿越、端口递增和数据库写入拒绝。测试类在启动前与停止后比较数据库文件 SHA-256。

安装 Playwright 的开发环境还可以运行桌面与手机端验收：

```powershell
$env:APP_URL = "http://127.0.0.1:8766"
node app/test_ui.cjs
```

该脚本校验关键总数、127 校列表、北京大学双单位详情、教师抽屉、人才分页、
两校对比、控件文字溢出、固定元素边界、Lucide 图标、浏览器错误与外部请求，
并将截图写入 `app/screenshots`。
