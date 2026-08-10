import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from "react";
import type { AppSettings, DependencyStatus, PrintJob, PrinterInfo, PrintOptions } from "@magic-printer/shared";

const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const token = localStorage.getItem("magic-printer-access-token");
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`/api/v1${path}`, { ...init, headers });
  if (!response.ok) {
    const raw = await response.text();
    try { throw new Error((JSON.parse(raw) as { error?: { message?: string } }).error?.message ?? `请求失败（${response.status}）`); }
    catch (error) { if (error instanceof Error && !error.message.startsWith("Unexpected token")) throw error; throw new Error(`请求失败（${response.status}）`); }
  }
  return response.status === 204 ? (undefined as T) : response.json();
};

const accessHeaders = () => {
  const token = localStorage.getItem("magic-printer-access-token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const withAccessToken = (url: string) => {
  const token = localStorage.getItem("magic-printer-access-token");
  return token ? `${url}${url.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}` : url;
};

type PrintProgress = "idle" | "queued" | "printing" | "succeeded" | "failed";

const printProgressInfo: Record<PrintProgress, { label: string; detail: string; value: number }> = {
  idle: { label: "等待开始", detail: "确认纸张和打印参数后开始打印。", value: 0 },
  queued: { label: "排队中", detail: "打印任务已提交，正在等待打印机。", value: 25 },
  printing: { label: "打印中", detail: "系统正在把文件发送到打印机。", value: 70 },
  succeeded: { label: "打印成功", detail: "打印任务已发送到打印机。", value: 100 },
  failed: { label: "打印失败", detail: "请检查打印机状态后重试。", value: 100 }
};

const paperSizeLabel = (size: string) => ({
  A5: "A5（实际纸张）"
}[size] ?? size);

export function App() {
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [selectedPrinterId, setSelectedPrinterId] = useState<string | null>(null);
  const [dependencies, setDependencies] = useState<DependencyStatus | null>(null);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMime, setPreviewMime] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [printProgress, setPrintProgress] = useState<PrintProgress>("idle");
  const [message, setMessage] = useState("正在连接本地服务…");
  const [theme, setTheme] = useState<"system" | "dark" | "light">("system");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isLocalClient, setIsLocalClient] = useState(false);
  const [printOptions, setPrintOptions] = useState<PrintOptions>({ copies: 1, orientation: "portrait", color: "color", duplex: "none", paperSize: "A4", paperLayout: "full" });
  const [security, setSecurity] = useState<{ lanAccess: boolean; pairingCode?: string; accessUrls?: string[] } | null>(null);
  const [pairingToken, setPairingToken] = useState("");
  const [visiblePairingCode, setVisiblePairingCode] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const restoredJobRef = useRef<string | null>(null);
  const selectedPrinter = printers.find((printer) => printer.id === selectedPrinterId);
  const printerCapabilities = selectedPrinter?.capabilities;
  const paperSizes = printerCapabilities?.paperSizes.length ? printerCapabilities.paperSizes : ["A4", "A5", "Letter"];
  const progressInfo = printProgressInfo[printProgress];

  const syncPrintOptions = (printer?: PrinterInfo) => {
    setPrintOptions((current) => {
      const availablePaperSizes = printer?.capabilities.paperSizes.length ? printer.capabilities.paperSizes : ["A4", "A5", "Letter"];
      return {
        ...current,
        color: printer?.capabilities.color === false ? "grayscale" : current.color,
        duplex: printer?.capabilities.duplex === false ? "none" : current.duplex,
        paperSize: availablePaperSizes.includes(current.paperSize) ? current.paperSize : availablePaperSizes[0] ?? current.paperSize,
        paperLayout: current.paperLayout === "half" && !availablePaperSizes.includes("A4") ? "full" : current.paperLayout
      };
    });
  };

  const refresh = async () => {
    try {
      const capabilities = await api<{ isLocalClient: boolean; printers: PrinterInfo[]; selectedPrinterId: string | null; dependencies: DependencyStatus; settings: AppSettings; security: { lanAccess: boolean; pairingCode?: string; accessUrls?: string[] } }>("/capabilities");
      setIsLocalClient(capabilities.isLocalClient);
      setPrinters(capabilities.printers);
      setSelectedPrinterId(capabilities.selectedPrinterId);
      syncPrintOptions(capabilities.printers.find((printer) => printer.id === capabilities.selectedPrinterId));
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
    if (!authRequired) return;
    void fetch("/api/v1/auth/pairing-code")
      .then((response) => response.ok ? response.json() as Promise<{ pairingCode?: string | null }> : null)
      .then((result) => setVisiblePairingCode(result?.pairingCode ?? null))
      .catch(() => setVisiblePairingCode(null));
  }, [authRequired]);

  useEffect(() => {
    if (!pendingJobId) return;
    const token = localStorage.getItem("magic-printer-access-token");
    const events = new EventSource(`/api/v1/jobs/${pendingJobId}/events${token ? `?access_token=${encodeURIComponent(token)}` : ""}`);
    events.onmessage = (event) => {
      const job = JSON.parse(event.data) as PrintJob;
      if (job.status === "queued" || job.status === "printing") setPrintProgress(job.status);
      if (job.status === "succeeded") setPrintProgress("succeeded");
      if (["failed", "cancelled"].includes(job.status)) setPrintProgress("failed");
      setMessage(job.status === "succeeded" ? "打印成功" : job.status === "failed" ? "打印失败" : `任务状态：${job.status}`);
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
      const next = await api<AppSettings>("/settings", { method: "PUT", body: JSON.stringify({ ...settings, server: { ...settings.server, host: lanAccess ? "0.0.0.0" : "127.0.0.1", lanAccess }, updatedAt: new Date().toISOString() }) });
      setSettings(next);
      setSecurity((current) => current ? { ...current, lanAccess: next.server.lanAccess, accessUrls: next.server.lanAccess ? (current.accessUrls ?? []) : [] } : current);
      setMessage(lanAccess ? "局域网访问已开启" : "局域网访问已关闭");
      window.setTimeout(() => void refresh(), 1200);
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

  const prepareJob = async (jobId: string) => {
    setPreviewError(null);
    const result = await api<{ preview: string; mimeType?: string }>(`/jobs/${jobId}/prepare`, { method: "POST" });
    const previewResponse = await fetch(withAccessToken(result.preview), { headers: accessHeaders() });
    if (!previewResponse.ok) throw new Error("预览文件加载失败，请重试");
    const blobUrl = URL.createObjectURL(await previewResponse.blob());
    setPreviewUrl((current) => { if (current?.startsWith("blob:")) URL.revokeObjectURL(current); return blobUrl; });
    setPreviewMime(result.mimeType ?? previewResponse.headers.get("content-type") ?? "application/pdf");
    setMessage("预览已准备完成，请确认打印参数");
  };

  useEffect(() => {
    if (pendingJobId || previewUrl || restoredJobRef.current) return;
    const candidate = jobs.find((job) => ["uploaded", "ready"].includes(job.status));
    if (!candidate) return;
    restoredJobRef.current = candidate.id;
    setPendingJobId(candidate.id);
    void prepareJob(candidate.id).catch((error) => {
      const text = error instanceof Error ? error.message : "预览准备失败";
      setMessage(text);
      setPreviewError(text);
    });
  }, [jobs, pendingJobId, previewUrl]);

  const uploadFile = async (selectedFile: File) => {
    const form = new FormData(); form.append("file", selectedFile);
    try {
      const response = await fetch("/api/v1/uploads", { method: "POST", headers: accessHeaders(), body: form });
      if (!response.ok) {
        const raw = await response.text();
        let error: { error?: { code?: string; message?: string } } = {};
        try { error = JSON.parse(raw) as typeof error; } catch { /* service may be restarting and return an empty/non-JSON response */ }
        if (response.status === 401 || error.error?.code === "AUTH_REQUIRED") setAuthRequired(true);
        throw new Error(error.error?.message ?? `上传失败（${response.status}）`);
      }
      const result = await response.json() as { job: PrintJob };
      setPendingJobId(result.job.id); setFile(null); await refresh();
      if (result.job.status === "blocked") {
        setPreviewUrl(null); setPreviewMime(null);
        const warning = "文件疑似已加密，请先解密后再打印";
        setMessage(warning);
        window.alert(warning);
        return;
      }
      await prepareJob(result.job.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "预览准备失败");
      setPreviewError(error instanceof Error ? error.message : "预览准备失败");
    }
  };

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    setPreviewUrl((current) => { if (current?.startsWith("blob:")) URL.revokeObjectURL(current); return null; });
    setPreviewMime(null);
    setPreviewError(null);
    setPendingJobId(null);
    setPrintProgress("idle");
    const selectedFile = event.target.files?.[0] ?? null;
    setFile(selectedFile);
    if (selectedFile) {
      setMessage("正在上传并准备预览…");
      void uploadFile(selectedFile);
    }
  };

  const upload = async () => {
    if (!file) return setMessage("请先选择文件");
    await uploadFile(file);
  };

  const printPending = async () => {
    if (!pendingJobId) return setMessage("请先上传文件");
    if (isPrinting) return;
    setIsPrinting(true);
    setPrintProgress("queued");
    setMessage("正在提交打印任务…");
    try {
      const result = await api<{ job?: PrintJob }>(`/jobs/${pendingJobId}/print`, { method: "POST", body: JSON.stringify(printOptions) });
      setPrintProgress(result.job?.status === "succeeded" ? "succeeded" : "printing");
      setPendingJobId(null);
      await refresh();
      setMessage("打印成功");
      window.alert("打印成功，任务已发送到打印机。");
    } catch (error) {
      const text = error instanceof Error ? error.message : "打印失败";
      setPrintProgress("failed");
      await refresh();
      setMessage(text);
    }
    finally { setIsPrinting(false); }
  };

  const deleteJob = async (jobId: string) => {
    const job = jobs.find((item) => item.id === jobId);
    if (!job || !window.confirm(`确认删除“${job.fileName}”吗？\n删除后将同时清理本地文件，且无法恢复。`)) return;
    try {
      await api(`/jobs/${jobId}`, { method: "DELETE" });
      setJobs((current) => current.filter((job) => job.id !== jobId));
      if (pendingJobId === jobId) {
        setPendingJobId(null);
        setPreviewUrl((current) => { if (current?.startsWith("blob:")) URL.revokeObjectURL(current); return null; });
        setPreviewMime(null);
        setPreviewError(null);
      }
      setMessage("打印记录已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除记录失败");
    }
  };

  const preparePending = async () => {
    if (!pendingJobId) return setMessage("请先上传文件");
    try {
      await prepareJob(pendingJobId); await refresh();
    } catch (error) {
      const text = error instanceof Error ? error.message : "预览准备失败";
      setMessage(text); setPreviewError(text); await refresh();
    }
  };

  const selectPrinter = async (id: string) => {
    const settings = await api<AppSettings>("/settings");
    await api<AppSettings>("/settings", { method: "PUT", body: JSON.stringify({ ...settings, selectedPrinterId: id, updatedAt: new Date().toISOString() }) });
    setSelectedPrinterId(id);
    const printer = printers.find((item) => item.id === id);
    syncPrintOptions(printer);
    setMessage("打印机配置已保存");
  };

  return <div className={`app-shell theme-${theme}`}>
    {authRequired && <div className="auth-overlay"><div className="auth-card"><span className="app-mark">M</span><span className="kicker">LAN PAIRING</span><h2>输入配对验证码</h2><p>请输入当前 Magic Printer 的 6 位验证码。</p>{visiblePairingCode && <div className="visible-pairing-code" aria-label="当前配对验证码"><span>当前验证码</span><strong>{visiblePairingCode}</strong></div>}<div className="pairing-hint"><span>验证码来源</span><strong>桌面端“服务与安全”区域</strong></div><div className="code-inputs" onPaste={handlePairingPaste}>{Array.from({ length: 6 }, (_, index) => <input key={index} data-code-index={index} inputMode="numeric" maxLength={1} value={pairingToken[index] ?? ""} onChange={(event) => updatePairingDigit(index, event.target.value)} onKeyDown={(event) => handlePairingKey(index, event)} autoFocus={index === 0} aria-label={`验证码第 ${index + 1} 位`} />)}</div><button className="primary-button" disabled={pairingToken.length !== 6} onClick={() => void pair()}>连接</button><small>{message}</small></div></div>}
    <header className="app-header"><div className="app-brand"><span className="app-mark">M</span><strong>Magic Printer</strong><span className="app-status"><i /> {message}</span></div><div className="header-actions"><span className="version">v0.1.0 preview</span><button className="ghost-button" onClick={() => void refresh()}>刷新</button></div></header>
    <div className="app-body">
      <aside className="app-sidebar"><button className="nav-item active" onClick={() => scrollTo("print-workspace")}>▣<span>打印</span></button><button className="nav-item" onClick={() => scrollTo("history")}>◴<span>记录</span></button>{isLocalClient && <button className="nav-item" onClick={() => scrollTo("settings")}>⚙<span>设置</span></button>}</aside>
      <main className="content"><div className="content-heading"><div><span className="kicker">PRINT WORKSPACE</span><h1>准备打印</h1><p>上传文件，确认预览，然后发送到已选择的打印机。</p></div><div className="printer-control"><label htmlFor="printer">当前打印机</label><select id="printer" value={selectedPrinterId ?? ""} onChange={(event) => void selectPrinter(event.target.value)}><option value="" disabled>请选择打印机</option>{printers.map((printer) => <option key={printer.id} value={printer.id}>{printer.name}{printer.isDefault ? "（默认）" : ""}</option>)}</select></div></div>
        <section id="print-workspace" className="workspace-grid">
          <div className={`upload-card${previewUrl ? " has-preview" : ""}`}>
            {previewUrl ? <>
              {previewMime?.startsWith("image/") ? <img className="preview-image" alt="文档预览" src={previewUrl} /> : <iframe className="preview-frame" title="文档预览" src={previewUrl} />}
              <label className="choose-button">选择新文件<input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.bmp,.tiff" onChange={chooseFile} /></label>
            </> : <>
              <div className="upload-icon">↥</div>
              <h2>{file ? file.name : pendingJobId ? (previewError ? "预览准备失败" : "正在准备预览") : "将文件拖放到这里"}</h2>
              <p>{file ? `${Math.ceil(file.size / 1024)} KB · ${file.type || "未知类型"}` : previewError ?? (pendingJobId ? "文件已上传，正在生成预览…" : "支持 PDF、Word、Excel 和常见图片格式")}</p>
              <label className="choose-button">选择文件<input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.bmp,.tiff" onChange={chooseFile} /></label>
              {file && <button className="primary-button" onClick={() => void upload()}>重新上传</button>}
              {pendingJobId && !previewUrl && <button className="secondary-button" onClick={() => void preparePending()}>重试预览</button>}
              <small>选择文件后将自动上传并准备预览。</small>
            </>}
          </div>
          <aside className="options-card">
            <h2>打印设置</h2>
            <label>份数<input type="number" min="1" max="99" value={printOptions.copies} onChange={(event) => setPrintOptions({ ...printOptions, copies: Math.min(99, Math.max(1, Number(event.target.value) || 1)) })} /></label>
            <label>纸张<select value={printOptions.paperSize} onChange={(event) => setPrintOptions((current) => ({ ...current, paperSize: event.target.value, paperLayout: current.paperLayout === "half" && event.target.value !== "A4" ? "full" : current.paperLayout }))}>{paperSizes.map((size) => <option key={size} value={size}>{paperSizeLabel(size)}</option>)}</select></label>
            <label>版式<select value={printOptions.paperLayout} onChange={(event) => setPrintOptions((current) => { const paperLayout = event.target.value as PrintOptions["paperLayout"]; return { ...current, paperLayout, paperSize: paperLayout === "half" ? "A4" : current.paperSize }; })}><option value="full">全张（A4）</option><option value="half" disabled={!paperSizes.includes("A4")}>半张（A4 发票）</option></select></label>
            <small className="layout-note">半张模式仍使用 A4 纸，按两页/张缩放到半张区域。</small>
            <label>方向<select value={printOptions.orientation} onChange={(event) => setPrintOptions({ ...printOptions, orientation: event.target.value as PrintOptions["orientation"] })}><option value="portrait">纵向</option><option value="landscape">横向</option></select></label>
            <label>颜色<select value={printOptions.color} onChange={(event) => setPrintOptions({ ...printOptions, color: event.target.value as PrintOptions["color"] })}><option value="color" disabled={printerCapabilities?.color === false}>彩色</option><option value="grayscale">黑白</option></select></label>
            <label>双面<select value={printOptions.duplex} onChange={(event) => setPrintOptions({ ...printOptions, duplex: event.target.value as PrintOptions["duplex"] })}><option value="none">单面</option><option value="long-edge" disabled={printerCapabilities?.duplex === false}>长边翻页</option><option value="short-edge" disabled={printerCapabilities?.duplex === false}>短边翻页</option></select></label>
            {printerCapabilities?.color === false && <div className="printer-capability-note">已检测到黑白打印机，颜色已自动切换为黑白。</div>}
            <div className="dependency"><span>Office 预览</span><strong className={dependencies?.libreOffice.available ? "ok" : "muted"}>{dependencies?.libreOffice.available ? "可用" : "未安装"}</strong></div>
            <div className={`print-progress ${printProgress}`} aria-label="打印阶段进度">
              <div className="progress-heading"><span>打印进度</span><strong>{progressInfo.label}</strong></div>
              <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressInfo.value} aria-valuetext={progressInfo.label}><span style={{ width: `${progressInfo.value}%` }} /></div>
              <small>{progressInfo.detail}</small>
            </div>
            <button className="primary-button" disabled={!selectedPrinterId || !pendingJobId || !previewUrl || isPrinting} onClick={() => void printPending()}>{isPrinting ? "正在打印…" : "开始打印"}</button>
          </aside>
        </section>
        <section id="history" className="history"><div className="section-title"><div><span className="kicker">RECENT JOBS</span><h2>最近记录</h2></div><span>保留最近七天</span></div>{jobs.length === 0 ? <div className="empty-state">还没有打印记录。上传第一个文件开始吧。</div> : <div className="job-list">{jobs.map((job) => <div className="job-row" key={job.id}><span className={`file-type ${job.mimeType.includes("pdf") ? "pdf" : "doc"}`}>{job.fileName.split(".").pop()?.toUpperCase()}</span><div><strong>{job.fileName}</strong><small>{job.createdAt} · {job.printerId ?? "未选择打印机"}</small></div><span className={`job-status ${job.status}`}>{job.status}</span><button className="ghost-button" onClick={() => void deleteJob(job.id)}>删除</button></div>)}</div>}</section>
        {isLocalClient && <>
          <section className="service-card"><div><span className="kicker">LOCAL SERVICE</span><h2>服务与安全</h2><p>{security?.lanAccess ? "局域网访问已开启，远程设备必须使用 6 位验证码。" : "当前仅允许本机访问。"}</p></div><div className="service-status"><span><i className="ok-dot" /> 本地服务在线</span><span>LibreOffice：{dependencies?.libreOffice.available ? "可用" : "未安装"}</span><span>E-safe：{dependencies?.encryptionDetector.available ? dependencies.encryptionDetector.provider : "等待接入"}</span>{security?.accessUrls?.map((url) => <code key={url}>访问 {url}</code>)}{security?.pairingCode && <div className="pairing-display" title="请只提供给可信设备">{security.pairingCode.split("").map((digit, index) => <b key={`${digit}-${index}`}>{digit}</b>)}</div>}<button className="ghost-button" onClick={() => void toggleLanAccess()}>{security?.lanAccess ? "关闭局域网访问" : "开启局域网访问"}</button></div></section>
          <section id="settings" className="settings-card"><div><span className="kicker">SETTINGS</span><h2>应用设置</h2><p>桌面应用和 WEB 打印页面共享这些本地配置。</p></div><div className="settings-grid"><label>主题<select value={settings?.theme ?? "system"} onChange={(event) => void saveSettings({ theme: event.target.value as AppSettings["theme"] })}><option value="system">跟随系统</option><option value="dark">深色</option><option value="light">浅色</option></select></label><label>开机启动<select value={settings?.launchAtStartup ? "on" : "off"} onChange={(event) => void saveSettings({ launchAtStartup: event.target.value === "on" })}><option value="off">关闭</option><option value="on">开启</option></select></label><label>Office 预览<select value={settings?.officePreview ? "on" : "off"} onChange={(event) => void saveSettings({ officePreview: event.target.value === "on" })}><option value="on">开启</option><option value="off">关闭</option></select></label><label>服务端口<input type="number" min="1024" max="65535" value={settings?.server.port ?? 17890} onChange={(event) => void saveSettings({ server: { ...(settings?.server ?? { host: "127.0.0.1", port: 17890, lanAccess: false }), port: Number(event.target.value) } })} /></label><div className="setting-note"><strong>预览环境</strong><span>LibreOffice：{dependencies?.libreOffice.available ? "已检测" : "未安装"}</span><span>E-safe：{dependencies?.encryptionDetector.available ? "已接入" : "待配置厂商检测器"}</span></div></div></section>
        </>}
      </main>
    </div>
  </div>;
}
