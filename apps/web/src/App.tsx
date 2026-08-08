import { useEffect, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from "react";
import type { AppSettings, DependencyStatus, PrintJob, PrinterInfo, PrintOptions } from "@magic-printer/shared";

const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const token = localStorage.getItem("magic-printer-access-token");
  const response = await fetch(`/api/v1${path}`, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) } });
  if (!response.ok) throw new Error((await response.json()).error?.message ?? "请求失败");
  return response.status === 204 ? (undefined as T) : response.json();
};

export function App() {
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [selectedPrinterId, setSelectedPrinterId] = useState<string | null>(null);
  const [dependencies, setDependencies] = useState<DependencyStatus | null>(null);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [message, setMessage] = useState("正在连接本地服务…");
  const [theme, setTheme] = useState<"system" | "dark" | "light">("system");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [printOptions, setPrintOptions] = useState<PrintOptions>({ copies: 1, orientation: "portrait", color: "color", duplex: "none", paperSize: "A4" });
  const [security, setSecurity] = useState<{ lanAccess: boolean; pairingCode?: string; accessUrls?: string[] } | null>(null);
  const [pairingToken, setPairingToken] = useState("");
  const [authRequired, setAuthRequired] = useState(false);
  const selectedPrinter = printers.find((printer) => printer.id === selectedPrinterId);
  const printerCapabilities = selectedPrinter?.capabilities;
  const paperSizes = printerCapabilities?.paperSizes.length ? printerCapabilities.paperSizes : ["A4", "Letter"];

  const refresh = async () => {
    try {
      const capabilities = await api<{ printers: PrinterInfo[]; selectedPrinterId: string | null; dependencies: DependencyStatus; settings: AppSettings; security: { lanAccess: boolean; pairingCode?: string; accessUrls?: string[] } }>("/capabilities");
      setPrinters(capabilities.printers);
      setSelectedPrinterId(capabilities.selectedPrinterId);
      setDependencies(capabilities.dependencies);
      setTheme(capabilities.settings.theme);
      setSettings(capabilities.settings);
      setSecurity(capabilities.security);
      setAuthRequired(false);
      const history = await api<{ jobs: PrintJob[] }>("/jobs");
      setJobs(history.jobs);
      setMessage("服务在线");
    } catch (error) { const text = error instanceof Error ? error.message : "无法连接本地服务"; setMessage(text); setAuthRequired(text.includes("授权口令")); }
  };

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    if (!pendingJobId) return;
    const token = localStorage.getItem("magic-printer-access-token");
    const events = new EventSource(`/api/v1/jobs/${pendingJobId}/events${token ? `?access_token=${encodeURIComponent(token)}` : ""}`);
    events.onmessage = (event) => {
      const job = JSON.parse(event.data) as PrintJob;
      setMessage(`任务状态：${job.status}`);
      if (["succeeded", "failed", "cancelled"].includes(job.status)) void refresh();
    };
    events.onerror = () => events.close();
    return () => events.close();
  }, [pendingJobId]);

  const pair = async () => {
    try {
      const response = await fetch("/api/v1/auth/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: pairingToken }) });
      if (!response.ok) throw new Error((await response.json()).error?.message ?? "配对失败");
      const result = await response.json() as { token: string };
      localStorage.setItem("magic-printer-access-token", result.token); setPairingToken(""); setAuthRequired(false); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "配对失败"); }
  };

  const toggleLanAccess = async () => {
    try {
      const settings = await api<AppSettings>("/settings");
      const lanAccess = !settings.server.lanAccess;
      await api<AppSettings>("/settings", { method: "PUT", body: JSON.stringify({ ...settings, server: { ...settings.server, host: lanAccess ? "0.0.0.0" : "127.0.0.1", lanAccess }, updatedAt: new Date().toISOString() }) });
      await refresh(); setMessage(lanAccess ? "局域网访问已开启，服务正在重启" : "局域网访问已关闭，服务正在重启");
    } catch (error) { setMessage(error instanceof Error ? error.message : "网络设置保存失败"); }
  };

  const saveSettings = async (changes: Partial<AppSettings>) => {
    if (!settings) return;
    try {
      const next = await api<AppSettings>("/settings", { method: "PUT", body: JSON.stringify({ ...settings, ...changes, updatedAt: new Date().toISOString() }) });
      setSettings(next); setTheme(next.theme); setMessage("设置已保存");
    } catch (error) { setMessage(error instanceof Error ? error.message : "设置保存失败"); }
  };

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const updatePairingDigit = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = pairingToken.padEnd(6, " ").split("");
    next[index] = digit || " ";
    const code = next.join("").replace(/ /g, "");
    setPairingToken(code);
    if (digit) document.querySelector<HTMLInputElement>(`[data-code-index="${index + 1}"]`)?.focus();
  };

  const handlePairingKey = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !pairingToken[index] && index > 0) document.querySelector<HTMLInputElement>(`[data-code-index="${index - 1}"]`)?.focus();
  };

  const handlePairingPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const code = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    setPairingToken(code);
    document.querySelector<HTMLInputElement>(`[data-code-index="${Math.min(code.length, 5)}"]`)?.focus();
  };

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0] ?? null);

  const upload = async () => {
    if (!file) return setMessage("请先选择文件");
    const form = new FormData(); form.append("file", file);
    try {
      const response = await fetch("/api/v1/uploads", { method: "POST", body: form });
      if (!response.ok) throw new Error((await response.json()).error?.message ?? "上传失败");
      const result = await response.json() as { job: PrintJob };
      setPendingJobId(result.job.id); setFile(null); setMessage("文件已加入任务，请确认后开始打印"); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "上传失败"); }
  };

  const printPending = async () => {
    if (!pendingJobId) return setMessage("请先上传文件");
    try {
      await api(`/jobs/${pendingJobId}/print`, { method: "POST", body: JSON.stringify(printOptions) });
      setPendingJobId(null); setMessage("打印任务已完成"); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "打印失败"); await refresh(); }
  };

  const preparePending = async () => {
    if (!pendingJobId) return setMessage("请先上传文件");
    try {
      const result = await api<{ preview: string }>(`/jobs/${pendingJobId}/prepare`, { method: "POST" });
      setPreviewUrl(result.preview); setMessage("预览已准备完成，请确认打印参数"); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "预览准备失败"); await refresh(); }
  };

  const selectPrinter = async (id: string) => {
    const settings = await api<AppSettings>("/settings");
    await api<AppSettings>("/settings", { method: "PUT", body: JSON.stringify({ ...settings, selectedPrinterId: id, updatedAt: new Date().toISOString() }) });
    setSelectedPrinterId(id);
    const printer = printers.find((item) => item.id === id);
    setPrintOptions((current) => ({
      ...current,
      color: printer?.capabilities.color === false ? "grayscale" : current.color,
      duplex: printer?.capabilities.duplex === false ? "none" : current.duplex,
      paperSize: printer?.capabilities.paperSizes.length && !printer.capabilities.paperSizes.includes(current.paperSize)
        ? printer.capabilities.paperSizes[0] ?? current.paperSize
        : current.paperSize
    }));
    setMessage("打印机配置已保存");
  };

  return <div className={`app-shell theme-${theme}`}>
    {authRequired && <div className="auth-overlay"><div className="auth-card"><span className="app-mark">M</span><h2>连接 Magic Printer</h2><p>请输入桌面端显示的 6 位局域网验证码。</p><div className="code-inputs" onPaste={handlePairingPaste}>{Array.from({ length: 6 }, (_, index) => <input key={index} data-code-index={index} inputMode="numeric" maxLength={1} value={pairingToken[index] ?? ""} onChange={(event) => updatePairingDigit(index, event.target.value)} onKeyDown={(event) => handlePairingKey(index, event)} autoFocus={index === 0} aria-label={`验证码第 ${index + 1} 位`} />)}</div><button className="primary-button" disabled={pairingToken.length !== 6} onClick={() => void pair()}>连接</button><small>{message}</small></div></div>}
    <header className="app-header"><div className="app-brand"><span className="app-mark">M</span><strong>Magic Printer</strong><span className="app-status"><i /> {message}</span></div><div className="header-actions"><span className="version">v0.1.0 preview</span><button className="ghost-button" onClick={() => void refresh()}>刷新</button></div></header>
    <div className="app-body">
      <aside className="app-sidebar"><button className="nav-item active" onClick={() => scrollTo("print-workspace")}>▣<span>打印</span></button><button className="nav-item" onClick={() => scrollTo("history")}>◴<span>记录</span></button><button className="nav-item" onClick={() => scrollTo("settings")}>⚙<span>设置</span></button></aside>
      <main className="content"><div className="content-heading"><div><span className="kicker">PRINT WORKSPACE</span><h1>准备打印</h1><p>上传文件，确认预览，然后发送到已选择的打印机。</p></div><div className="printer-control"><label htmlFor="printer">当前打印机</label><select id="printer" value={selectedPrinterId ?? ""} onChange={(event) => void selectPrinter(event.target.value)}><option value="" disabled>请选择打印机</option>{printers.map((printer) => <option key={printer.id} value={printer.id}>{printer.name}{printer.isDefault ? "（默认）" : ""}</option>)}</select></div></div>
        <section id="print-workspace" className="workspace-grid"><div className="upload-card">{previewUrl ? <iframe className="preview-frame" title="文档预览" src={previewUrl} /> : <><div className="upload-icon">↥</div><h2>{file ? file.name : pendingJobId ? "文件已准备" : "将文件拖放到这里"}</h2><p>{file ? `${Math.ceil(file.size / 1024)} KB · ${file.type || "未知类型"}` : pendingJobId ? "请先准备预览，再确认打印参数" : "支持 PDF、Word、Excel 和常见图片格式"}</p><label className="choose-button">选择文件<input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.bmp,.tiff" onChange={chooseFile} /></label>{file && <button className="primary-button" onClick={() => void upload()}>上传文件</button>}{pendingJobId && <button className="secondary-button" onClick={() => void preparePending()}>准备预览</button>}<small>文件默认只保存在本机，不会上传到云端。</small></>}</div><aside className="options-card"><h2>打印设置</h2><label>份数<input type="number" min="1" max="99" value={printOptions.copies} onChange={(event) => setPrintOptions({ ...printOptions, copies: Math.min(99, Math.max(1, Number(event.target.value) || 1)) })} /></label><label>纸张<select value={printOptions.paperSize} onChange={(event) => setPrintOptions({ ...printOptions, paperSize: event.target.value })}>{paperSizes.map((size) => <option key={size}>{size}</option>)}</select></label><label>方向<select value={printOptions.orientation} onChange={(event) => setPrintOptions({ ...printOptions, orientation: event.target.value as PrintOptions["orientation"] })}><option value="portrait">纵向</option><option value="landscape">横向</option></select></label><label>颜色<select value={printOptions.color} onChange={(event) => setPrintOptions({ ...printOptions, color: event.target.value as PrintOptions["color"] })}><option value="color" disabled={printerCapabilities?.color === false}>彩色</option><option value="grayscale">黑白</option></select></label><label>双面<select value={printOptions.duplex} onChange={(event) => setPrintOptions({ ...printOptions, duplex: event.target.value as PrintOptions["duplex"] })}><option value="none">单面</option><option value="long-edge" disabled={printerCapabilities?.duplex === false}>长边翻页</option><option value="short-edge" disabled={printerCapabilities?.duplex === false}>短边翻页</option></select></label><div className="dependency"><span>Office 预览</span><strong className={dependencies?.libreOffice.available ? "ok" : "muted"}>{dependencies?.libreOffice.available ? "可用" : "未安装"}</strong></div><button className="primary-button" disabled={!selectedPrinterId || !pendingJobId || !previewUrl} onClick={() => void printPending()}>开始打印</button></aside></section>
        <section id="history" className="history"><div className="section-title"><div><span className="kicker">RECENT JOBS</span><h2>最近记录</h2></div><span>保留最近七天</span></div>{jobs.length === 0 ? <div className="empty-state">还没有打印记录。上传第一个文件开始吧。</div> : <div className="job-list">{jobs.map((job) => <div className="job-row" key={job.id}><span className={`file-type ${job.mimeType.includes("pdf") ? "pdf" : "doc"}`}>{job.fileName.split(".").pop()?.toUpperCase()}</span><div><strong>{job.fileName}</strong><small>{job.createdAt} · {job.printerId ?? "未选择打印机"}</small></div><span className={`job-status ${job.status}`}>{job.status}</span><button className="ghost-button" onClick={() => api(`/jobs/${job.id}`, { method: "DELETE" }).then(refresh)}>删除</button></div>)}</div>}</section>
        <section className="service-card"><div><span className="kicker">LOCAL SERVICE</span><h2>服务与安全</h2><p>{security?.lanAccess ? "局域网访问已开启，远程设备必须使用 6 位验证码。" : "当前仅允许本机访问。"}</p></div><div className="service-status"><span><i className="ok-dot" /> 本地服务在线</span><span>LibreOffice：{dependencies?.libreOffice.available ? "可用" : "未安装"}</span><span>E-safe：{dependencies?.encryptionDetector.available ? dependencies.encryptionDetector.provider : "等待接入"}</span>{security?.accessUrls?.map((url) => <code key={url}>访问 {url}</code>)}{security?.pairingCode && <div className="pairing-display" title="请只提供给可信设备">{security.pairingCode.split("").map((digit, index) => <b key={`${digit}-${index}`}>{digit}</b>)}</div>}<button className="ghost-button" onClick={() => void toggleLanAccess()}>{security?.lanAccess ? "关闭局域网访问" : "开启局域网访问"}</button></div></section>
        <section id="settings" className="settings-card"><div><span className="kicker">SETTINGS</span><h2>应用设置</h2><p>桌面应用和 WEB 打印页面共享这些本地配置。</p></div><div className="settings-grid"><label>主题<select value={settings?.theme ?? "system"} onChange={(event) => void saveSettings({ theme: event.target.value as AppSettings["theme"] })}><option value="system">跟随系统</option><option value="dark">深色</option><option value="light">浅色</option></select></label><label>开机启动<select value={settings?.launchAtStartup ? "on" : "off"} onChange={(event) => void saveSettings({ launchAtStartup: event.target.value === "on" })}><option value="off">关闭</option><option value="on">开启</option></select></label><label>服务端口<input type="number" min="1024" max="65535" value={settings?.server.port ?? 17890} onChange={(event) => void saveSettings({ server: { ...(settings?.server ?? { host: "127.0.0.1", port: 17890, lanAccess: false }), port: Number(event.target.value) } })} /></label><div className="setting-note"><strong>预览环境</strong><span>LibreOffice：{dependencies?.libreOffice.available ? "已检测" : "未安装"}</span><span>E-safe：{dependencies?.encryptionDetector.available ? "已接入" : "待配置厂商检测器"}</span></div></div></section>
      </main>
    </div>
  </div>;
}
