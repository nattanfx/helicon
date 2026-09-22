// Subsistema GUI em todo build: um build de depuração abriria senão uma janela de console perdida.
// Nada se perde, a saída do servidor vai para o server.log.
#![windows_subsystem = "windows"]

use std::ffi::{OsStr, OsString};
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{Manager, Url, WebviewUrl, WebviewWindowBuilder};
#[cfg(target_os = "macos")]
use tauri::Emitter;

struct ServerChild(Arc<Mutex<Option<Child>>>);

/// Para o servidor local quando o Tauri limpa seus recursos, o que o atualizador faz logo antes de
/// sair do app para rodar o instalador; um fechamento normal o para no manipulador Destroyed da janela.
struct ServerGuard(Arc<Mutex<Option<Child>>>);

impl tauri::Resource for ServerGuard {}

impl Drop for ServerGuard {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
}

/// O Windows ganha a barra de título própria do Helicon, desenhada pela interface; o macOS mantém os
/// semáforos nativos sobrepostos à interface, para a barra lateral ocupar a altura toda da janela; outras
/// plataformas mantêm a moldura nativa.
const CUSTOM_FRAME: bool = cfg!(windows);

/// Diz à interface, antes de carregar, para desenhar os controles de janela e as regiões de arrasto.
const FRAME_SCRIPT: &str = "window.__HELICON_FRAME__ = 'custom';";

/// Diz à interface, antes de carregar, que os semáforos do macOS flutuam sobre a barra lateral.
#[cfg(target_os = "macos")]
const OVERLAY_SCRIPT: &str = "window.__HELICON_TITLEBAR__ = 'overlay';";

/// Onde a porta do servidor é lembrada entre aberturas, dentro da pasta de dados do app.
const PORT_FILE: &str = "server-port";

/// Mostrado no instante em que a janela abre, enquanto o servidor local inicia. As cores do sistema seguem o tema do SO.
const SPLASH_PAGE: &str = "data:text/html,<!doctype html><meta charset=utf-8><title>Helicon</title><style>html{color-scheme:light dark;background:Canvas;color:GrayText;font:13px system-ui,sans-serif}body{margin:0;height:100vh;display:grid;place-items:center}</style><body>Iniciando o Helicon</body>";

const MISSING_NODE_PAGE: &str = "data:text/html,<!doctype html><meta charset=utf-8><title>Helicon</title><style>html{color-scheme:light dark;background:Canvas;color:CanvasText;font:14px/1.5 system-ui,sans-serif}body{margin:0;height:100vh;display:grid;place-items:center}main{max-width:420px;padding:24px}p{color:GrayText}</style><main><h1 style=font-size:20px>O Helicon precisa do Node.js</h1><p>O Helicon não conseguiu iniciar seu servidor local porque o Node.js embutido está ausente e não foi encontrado Node.js 22 ou mais novo neste computador. Reinstale o Helicon ou instale o Node.js 22 ou mais novo e abra o Helicon de novo.</p></main>";

const MISSING_SERVER_PAGE: &str = "data:text/html,<!doctype html><meta charset=utf-8><title>Helicon</title><style>html{color-scheme:light dark;background:Canvas;color:CanvasText;font:14px/1.5 system-ui,sans-serif}body{margin:0;height:100vh;display:grid;place-items:center}main{max-width:420px;padding:24px}p{color:GrayText}</style><main><h1 style=font-size:20px>Faltam arquivos no Helicon</h1><p>O servidor Helicon embutido não foi encontrado ao lado do app. Reinstale o Helicon para restaurá-lo.</p></main>";

const SERVER_FAILED_PAGE: &str = "data:text/html,<!doctype html><meta charset=utf-8><title>Helicon</title><style>html{color-scheme:light dark;background:Canvas;color:CanvasText;font:14px/1.5 system-ui,sans-serif}body{margin:0;height:100vh;display:grid;place-items:center}main{max-width:420px;padding:24px}p{color:GrayText}</style><main><h1 style=font-size:20px>O Helicon não conseguiu iniciar</h1><p>O servidor local não subiu. O log do servidor na pasta de logs do app Helicon tem os detalhes. Feche o Helicon e abra de novo para tentar outra vez.</p></main>";

enum BootError {
    NodeMissing,
    ServerMissing,
    ServerFailed,
}

impl BootError {
    fn page(&self) -> &'static str {
        match self {
            BootError::NodeMissing => MISSING_NODE_PAGE,
            BootError::ServerMissing => MISSING_SERVER_PAGE,
            BootError::ServerFailed => SERVER_FAILED_PAGE,
        }
    }
}

/// Por que uma inicialização do servidor não produziu URL. Um servidor que sai de imediato pode ter perdido sua porta para outro
/// processo entre a verificação e seu próprio bind; um que nunca responde ou nunca nasceu não seria
/// ajudado por outra porta.
enum StartFailure {
    Exited,
    Failed,
}

/// O Tauri entrega caminhos literais `\\?\` no Windows; o Node não consegue carregar um módulo principal de um.
fn plain_path(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path.to_path_buf()
}

/// Recursos embutidos mantêm seu caminho relativo (`resources/server.cjs`); layouts antigos os punham na raiz.
fn find_resource(resource_dir: &Path, name: &str) -> Option<PathBuf> {
    [resource_dir.join("resources").join(name), resource_dir.join(name)]
        .into_iter()
        .find(|candidate| candidate.exists())
        .map(|found| plain_path(&found))
}

fn port_free(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// A porta que o servidor local tinha da última vez, enquanto ainda estiver livre. A origem da janela inclui a
/// porta e a interface guarda suas configurações no armazenamento dessa origem, então uma porta nova a cada abertura as esqueceria,
/// inclusive atualizações automáticas desligadas.
fn stable_port(data_dir: Option<&Path>) -> u16 {
    let saved = data_dir
        .and_then(|dir| std::fs::read_to_string(dir.join(PORT_FILE)).ok())
        .and_then(|text| text.trim().parse::<u16>().ok())
        .filter(|port| *port != 0);
    match saved {
        Some(port) if port_free(port) => port,
        _ => fresh_port(data_dir),
    }
}

/// Cópia recuperável de edições de arquivo por instalação, fora da origem web da janela.
/// O `localStorage` é por origem (esquema, host e porta); quando a porta anterior está ocupada e o
/// servidor sobe noutra, a origem nova não enxerga a cópia guardada pela antiga. Este arquivo vive na
/// pasta de dados do app — separada entre normal e Teste pelo identificador — então sobrevive à troca
/// de porta. O conteúdo é texto opaco aqui; a interface valida ao carregar.
const DRAFTS_FILE: &str = "file-drafts.json";
/// A versão anterior a cada escrita, para restauração manual se o arquivo corromper.
const DRAFTS_BACKUP_FILE: &str = "file-drafts.json.bak";

fn drafts_paths(data_dir: Option<&Path>) -> Option<(PathBuf, PathBuf)> {
    let dir = data_dir?;
    std::fs::create_dir_all(dir).ok()?;
    Some((plain_path(&dir.join(DRAFTS_FILE)), plain_path(&dir.join(DRAFTS_BACKUP_FILE))))
}

fn read_drafts_file(path: &Path) -> Option<String> {
    std::fs::read_to_string(path).ok().filter(|text| !text.trim().is_empty())
}

fn load_drafts_from(data_dir: &Path) -> Option<String> {
    let (path, _) = drafts_paths(Some(data_dir))?;
    read_drafts_file(&path)
}

fn save_drafts_to(data_dir: &Path, content: &str) -> Result<(), String> {
    let (path, backup) = drafts_paths(Some(data_dir)).ok_or_else(|| "pasta de dados indisponível".to_string())?;
    if content.trim().is_empty() || content.trim() == "{}" {
        let _ = std::fs::remove_file(&path);
        return Ok(());
    }
    if path.exists() {
        let _ = std::fs::copy(&path, &backup);
    }
    std::fs::write(&path, content).map_err(|error| format!("não foi possível guardar a cópia: {error}"))?;
    Ok(())
}

/// Lê a cópia estável de edições; `None` = sem cópia (a interface usa o `localStorage` da origem atual).
#[tauri::command]
fn helicon_load_file_drafts(app: tauri::AppHandle) -> Option<String> {
    let dir = app.path().app_data_dir().ok().map(|dir| plain_path(&dir))?;
    load_drafts_from(&dir)
}

/// Guarda a cópia estável de edições; vazio remove o arquivo. Guarda a versão anterior em `.bak`.
#[tauri::command]
fn helicon_save_file_drafts(app: tauri::AppHandle, content: String) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| plain_path(&dir))
        .ok_or_else(|| "pasta de dados indisponível".to_string())?;
    save_drafts_to(&dir, &content)
}

/// Uma porta que nada está usando agora, lembrada para a próxima abertura. Retorna 0, qualquer porta livre, só
/// quando nenhuma pode ser encontrada.
fn fresh_port(data_dir: Option<&Path>) -> u16 {
    let port = TcpListener::bind(("127.0.0.1", 0))
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .unwrap_or(0);
    if port != 0 {
        if let Some(dir) = data_dir {
            let _ = std::fs::write(dir.join(PORT_FILE), port.to_string());
        }
    }
    port
}

/// Inicia o servidor na `port` e, mais uma vez, numa porta nova se ele sair de imediato.
fn start_with_retry<T>(
    port: u16,
    fresh: impl FnOnce() -> u16,
    mut spawn: impl FnMut(u16) -> Result<T, StartFailure>,
) -> Result<T, BootError> {
    match spawn(port) {
        Ok(started) => Ok(started),
        Err(StartFailure::Exited) => spawn(fresh()).map_err(|_| BootError::ServerFailed),
        Err(StartFailure::Failed) => Err(BootError::ServerFailed),
    }
}

/// Um processo filho que nunca pisca uma janela de console no Windows.
fn command<S: AsRef<OsStr>>(program: S) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn node_runs(program: &Path) -> bool {
    command(program)
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// O runtime Node.js que acompanha o executável do app como sidecar do Tauri, quando este build tem um.
fn bundled_node() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    bundled_node_in(exe.parent()?)
}

fn bundled_node_in(dir: &Path) -> Option<PathBuf> {
    let name = if cfg!(windows) { "node.exe" } else { "node" };
    Some(dir.join(name)).filter(|path| path.is_file()).map(|path| plain_path(&path))
}

/// O Node.js embutido primeiro, para os usuários não precisarem instalar nada. Sem ele (um build de código-fonte ou uma instalação
/// danificada), o Node.js como um terminal o vê. Apps GUI no macOS iniciam com um PATH mínimo que perde o
/// Homebrew, o ~/.local/bin e tudo que um gerenciador de versões adiciona pelos arquivos rc do shell, então
/// o `node` puro falha para a maioria quando o Helicon é aberto pelo Finder em vez de um terminal.
fn find_node() -> Option<PathBuf> {
    if let Some(bundled) = bundled_node().filter(|node| node_runs(node)) {
        return Some(bundled);
    }
    let mut candidates = vec![PathBuf::from("node")];
    #[cfg(unix)]
    {
        if let Some(found) = shell_probe("/bin/sh", &["-lc", "command -v node"]) {
            candidates.push(found);
        }
        if let Ok(shell) = std::env::var("SHELL") {
            if shell != "/bin/sh" {
                // Login mais interativo, para os arquivos rc estilo .zshrc rodarem e gerenciadores como fnm, nvm,
                // volta e mise colocarem seu node no PATH.
                let probe = if shell.ends_with("csh") {
                    "which node"
                } else {
                    "command -v node"
                };
                if let Some(found) = shell_probe(&shell, &["-li", "-c", probe]) {
                    candidates.push(found);
                }
            }
        }
        candidates.extend(well_known_nodes());
    }
    candidates.into_iter().find(|candidate| node_runs(candidate))
}

/// Roda uma sonda de shell com timeout: arquivos rc podem travar, e o boot não pode travar com eles.
#[cfg(unix)]
fn shell_probe(shell: &str, args: &[&str]) -> Option<PathBuf> {
    let shell = shell.to_string();
    let args: Vec<String> = args.iter().map(|arg| arg.to_string()).collect();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let output = command(&shell).args(&args).output().ok();
        let _ = tx.send(output);
    });
    let output = rx.recv_timeout(Duration::from_secs(10)).ok()??;
    if !output.status.success() {
        return None;
    }
    // A sonda roda depois dos arquivos rc, então sua resposta é a última linha parecida com caminho; qualquer coisa que os
    // arquivos rc imprimiram acima dela é ignorado.
    select_probe_path(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(unix)]
fn select_probe_path(output: &str) -> Option<PathBuf> {
    output
        .lines()
        .rev()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .find(|path| path.is_absolute() && path.is_file())
}

/// Binários do Node em suas casas usuais, para quando os shells acima não os conhecem.
#[cfg(unix)]
fn well_known_nodes() -> Vec<PathBuf> {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return Vec::new();
    };
    well_known_nodes_in(&home)
}

#[cfg(unix)]
fn well_known_nodes_in(home: &Path) -> Vec<PathBuf> {
    let mut nodes = vec![
        PathBuf::from("/opt/homebrew/bin/node"),
        PathBuf::from("/usr/local/bin/node"),
        PathBuf::from("/opt/local/bin/node"),
        home.join(".local/bin/node"),
        home.join(".volta/bin/node"),
        home.join(".asdf/shims/node"),
        home.join(".local/share/mise/shims/node"),
        home.join(".fnm/aliases/default/bin/node"),
    ];
    if let Some(nvm) = latest_nvm_node(home) {
        nodes.push(nvm);
    }
    nodes.into_iter().filter(|node| node.is_file()).collect()
}

/// O node mais novo que o nvm instalou, por número de versão.
#[cfg(unix)]
fn latest_nvm_node(home: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(home.join(".nvm/versions/node")).ok()?;
    let mut versions: Vec<(Vec<u64>, PathBuf)> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(number) = name.strip_prefix('v') else {
            continue;
        };
        let parts: Option<Vec<u64>> = number.split('.').map(|part| part.parse::<u64>().ok()).collect();
        let node = entry.path().join("bin/node");
        if let (Some(parts), true) = (parts, node.is_file()) {
            versions.push((parts, node));
        }
    }
    versions.sort_by(|a, b| a.0.cmp(&b.0));
    versions.pop().map(|(_, node)| node)
}

/// Um PATH para o servidor que vê o que um terminal vê: o node encontrado, mais as pastas bin do
/// usuário, na frente do que o app herdou. As sondas do próprio servidor (`muse`, skills)
/// e os comandos `!` do usuário rodam todos sob ele.
#[cfg(unix)]
fn augmented_path(node: &Path) -> Option<OsString> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut prepend: Vec<PathBuf> = Vec::new();
    // O node embutido fica ao lado do executável do app; colocar essa pasta primeiro sombrearia o
    // node do próprio usuário para seus comandos `!`.
    if node.is_absolute() && bundled_node().as_deref() != Some(node) {
        if let Some(dir) = node.parent() {
            prepend.push(dir.to_path_buf());
        }
    }
    let mut folders = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/opt/local/bin"),
    ];
    if let Some(home) = &home {
        folders.extend([home.join(".local/bin"), home.join(".volta/bin"), home.join(".asdf/shims")]);
    }
    prepend.extend(folders.into_iter().filter(|dir| dir.is_dir()));
    if prepend.is_empty() {
        return None;
    }
    Some(prepend_to_path(&prepend, std::env::var_os("PATH")))
}

#[cfg(unix)]
fn prepend_to_path(prepend: &[PathBuf], current: Option<OsString>) -> OsString {
    let mut parts: Vec<OsString> = prepend.iter().map(|dir| dir.as_os_str().to_os_string()).collect();
    let already: Vec<PathBuf> = current
        .as_ref()
        .map(|path| std::env::split_paths(path).collect())
        .unwrap_or_default();
    parts.retain(|dir| !already.iter().any(|have| have.as_os_str() == dir));
    if let Some(current) = current {
        if !current.is_empty() {
            parts.push(current);
        }
    }
    let mut joined = OsString::new();
    for (index, part) in parts.iter().enumerate() {
        if index > 0 {
            joined.push(":");
        }
        joined.push(part);
    }
    joined
}

fn wait_for_url(child: &mut Child) -> Option<String> {
    let stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        if reader.read_line(&mut line).is_ok() {
            let _ = tx.send(line);
        }
    });
    let line = rx.recv_timeout(Duration::from_secs(25)).ok()?;
    parse_listening_url(&line)
}

fn parse_listening_url(line: &str) -> Option<String> {
    let rest = line.split("http://").nth(1)?;
    Some(format!("http://{}", rest.trim()))
}

/// Uma tentativa de rodar o servidor embutido na `port`, retornando-o com a URL que anunciou.
#[allow(clippy::too_many_arguments)]
fn spawn_server(
    app: &tauri::AppHandle,
    node: &Path,
    server: &Path,
    frontend: Option<&Path>,
    data: Option<&Path>,
    port: u16,
) -> Result<(Child, String), StartFailure> {
    let mut cmd = command(node);
    #[cfg(unix)]
    if let Some(path) = augmented_path(node) {
        cmd.env("PATH", path);
    }
    // O servidor entrega uma URL de uso único pelo pipe privado; a janela recebe seu cookie ao abri-la.
    cmd.arg(server)
        .arg("--port")
        .arg(port.to_string())
        .arg("--desktop-auth");
    if let Some(frontend) = frontend {
        cmd.arg("--static").arg(frontend);
    }
    if let Some(data) = data {
        cmd.arg("--data-dir").arg(data);
    }
    let log = app
        .path()
        .app_log_dir()
        .ok()
        .map(|dir| plain_path(&dir))
        .and_then(|dir| std::fs::create_dir_all(&dir).ok().map(|_| dir.join("server.log")))
        .and_then(|path| OpenOptions::new().create(true).append(true).open(path).ok());
    cmd.stdout(Stdio::piped())
        .stderr(log.map(Stdio::from).unwrap_or_else(Stdio::null));
    let mut child = cmd.spawn().map_err(|_| StartFailure::Failed)?;
    if let Some(url) = wait_for_url(&mut child) {
        return Ok((child, url));
    }
    // Sua saída pode terminar um instante antes de a saída ser relatada, então dê até um segundo para ela aparecer.
    let exited = (0..20).any(|_| {
        let done = matches!(child.try_wait(), Ok(Some(_)));
        if !done {
            std::thread::sleep(Duration::from_millis(50));
        }
        done
    });
    let _ = child.kill();
    let _ = child.wait();
    Err(if exited { StartFailure::Exited } else { StartFailure::Failed })
}

fn boot_server(app: &tauri::AppHandle) -> Result<String, BootError> {
    let node = find_node().ok_or(BootError::NodeMissing)?;
    let resource_dir = app.path().resource_dir().map_err(|_| BootError::ServerMissing)?;
    let server = find_resource(&resource_dir, "server.cjs").ok_or(BootError::ServerMissing)?;
    let frontend = find_resource(&resource_dir, "frontend");
    // Projetos, fixações e títulos de conversas persistem por usuário, ao lado dos outros dados do app.
    let data = app
        .path()
        .app_data_dir()
        .ok()
        .filter(|dir| std::fs::create_dir_all(dir).is_ok())
        .map(|dir| plain_path(&dir));
    let (child, url) = start_with_retry(
        stable_port(data.as_deref()),
        || fresh_port(data.as_deref()),
        |port| spawn_server(app, &node, &server, frontend.as_deref(), data.as_deref(), port),
    )?;
    if let Some(state) = app.try_state::<ServerChild>() {
        if let Ok(mut guard) = state.0.lock() {
            *guard = Some(child);
        }
        app.resources_table().add(ServerGuard(state.0.clone()));
    }
    Ok(url)
}

/// A WKWebView engole Cmd+/− para seu próprio zoom de página antes de o JS vê-los. Um menu Visualizar nativo
/// pega essas teclas e emite `helicon://zoom` para a interface escalonar o zoom do Helicon.
#[cfg(target_os = "macos")]
fn install_zoom_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};

    let zoom_in = MenuItemBuilder::with_id("zoom-in", "Ampliar")
        .accelerator("CmdOrCtrl+=")
        .build(app)?;
    let zoom_out = MenuItemBuilder::with_id("zoom-out", "Reduzir")
        .accelerator("CmdOrCtrl+-")
        .build(app)?;
    let zoom_reset = MenuItemBuilder::with_id("zoom-reset", "Tamanho Real")
        .accelerator("CmdOrCtrl+0")
        .build(app)?;
    let app_menu = SubmenuBuilder::new(app, "Helicon")
        .about(None)
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let edit = SubmenuBuilder::new(app, "Editar")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view = SubmenuBuilder::new(app, "Visualizar")
        .item(&zoom_in)
        .item(&zoom_out)
        .item(&zoom_reset)
        .build()?;
    let window = SubmenuBuilder::new(app, "Janela")
        .minimize()
        .separator()
        .close_window()
        .build()?;
    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&edit)
        .item(&view)
        .item(&window)
        .build()?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let step = match event.id().0.as_str() {
            "zoom-in" => "in",
            "zoom-out" => "out",
            "zoom-reset" => "reset",
            _ => return,
        };
        let _ = app.emit("helicon://zoom", step);
    });
    Ok(())
}

/// Links web e de e-mail que pertencem ao navegador ou app de e-mail do usuário. O servidor local do próprio Helicon, as páginas
/// de splash e de erro embutidas e os esquemas internos do Tauri ficam na janela.
fn is_external_link(url: &Url) -> bool {
    match url.scheme() {
        "mailto" => true,
        "http" | "https" => !matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]" | "ipc.localhost" | "tauri.localhost")),
        _ => false,
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // Mantém tamanho/posição normais e maximização; não restaura uma janela oculta
                // nem a moldura nativa usada temporariamente pelas páginas de erro.
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .manage(ServerChild(Arc::new(Mutex::new(None))))
        .invoke_handler(tauri::generate_handler![helicon_load_file_drafts, helicon_save_file_drafts])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            install_zoom_menu(app)?;
            // Abre a janela de imediato numa página de splash; o servidor pode levar alguns segundos sondando o WSL.
            let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(SPLASH_PAGE.parse()?))
                .title(app.config().product_name.as_deref().unwrap_or("Helicon"))
                .inner_size(1280.0, 820.0)
                .min_inner_size(880.0, 560.0)
                // O arrastar-arquivo nativo consome o DnD do HTML5 (reordenar barra lateral, anexar no composer) no Windows.
                .disable_drag_drop_handler()
                // Um link destinado ao navegador (`target="_blank"`, ou um que levaria o app para longe)
                // abre no navegador padrão do usuário em vez de não fazer nada ou substituir o Helicon.
                .on_new_window(|url, _features| {
                    if is_external_link(&url) {
                        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
                    }
                    tauri::webview::NewWindowResponse::Deny
                })
                .on_navigation(|url| {
                    if is_external_link(url) {
                        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
                        return false;
                    }
                    true
                });
            if CUSTOM_FRAME {
                builder = builder.decorations(false).initialization_script(FRAME_SCRIPT);
            }
            // Os semáforos flutuam sobre o canto superior esquerdo da barra lateral; a interface deixa espaço
            // para eles e marca seus cabeçalhos como regiões de arrasto, como o T3 Code.
            #[cfg(target_os = "macos")]
            {
                builder = builder
                    .title_bar_style(tauri::TitleBarStyle::Overlay)
                    .hidden_title(true)
                    .traffic_light_position(tauri::LogicalPosition::new(20.0, 20.0))
                    .initialization_script(OVERLAY_SCRIPT);
            }
            let window = builder.build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let target = match boot_server(&handle) {
                    Ok(url) => url,
                    Err(error) => {
                        // Páginas de erro não desenham controles de janela, então ganham a moldura nativa de volta.
                        if CUSTOM_FRAME {
                            let _ = window.set_decorations(true);
                        }
                        error.page().to_string()
                    }
                };
                if let Ok(url) = target.parse::<Url>() {
                    let _ = window.navigate(url);
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::Destroyed = event {
                    if let Some(state) = window.app_handle().try_state::<ServerChild>() {
                        if let Ok(mut guard) = state.0.lock() {
                            if let Some(mut child) = guard.take() {
                                let _ = child.kill();
                            }
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Helicon failed to start");
}

#[cfg(test)]
mod tests {
    use super::{
        bundled_node_in, find_resource, fresh_port, load_drafts_from, parse_listening_url, plain_path, save_drafts_to, stable_port,
        start_with_retry, BootError, StartFailure, PORT_FILE, SPLASH_PAGE,
    };
    #[cfg(unix)]
    use super::{latest_nvm_node, prepend_to_path, select_probe_path, well_known_nodes_in};
    use std::net::TcpListener;
    use std::path::{Path, PathBuf};

    #[test]
    fn sends_only_outside_links_to_the_browser() {
        let external = |u: &str| super::is_external_link(&u.parse::<tauri::Url>().unwrap());
        assert!(external("https://github.com/HarjjotSinghh/helicon/pull/90"));
        assert!(external("mailto:hi@helicon.sh"));
        assert!(!external("http://127.0.0.1:52314/threads/abc"));
        assert!(!external("http://localhost:5173/"));
        assert!(!external("http://ipc.localhost/plugin"));
        assert!(!external("tauri://localhost/"));
        assert!(!external("data:text/html,hi"));
    }

    #[test]
    fn strips_windows_verbatim_prefixes() {
        assert_eq!(plain_path(Path::new(r"\\?\D:\apps\helicon\server.cjs")), PathBuf::from(r"D:\apps\helicon\server.cjs"));
        assert_eq!(plain_path(Path::new(r"\\?\UNC\host\share\x")), PathBuf::from(r"\\host\share\x"));
        assert_eq!(plain_path(Path::new("/usr/lib/helicon")), PathBuf::from("/usr/lib/helicon"));
    }

    #[test]
    fn parses_the_listening_line() {
        assert_eq!(
            parse_listening_url("helicon-server listening on http://127.0.0.1:52314\n"),
            Some("http://127.0.0.1:52314".to_string())
        );
        assert_eq!(
            parse_listening_url("helicon-server listening on http://127.0.0.1:52314/api/desktop-auth?key=test-key\n"),
            Some("http://127.0.0.1:52314/api/desktop-auth?key=test-key".to_string())
        );
        assert_eq!(parse_listening_url("noise without url"), None);
    }

    #[test]
    fn inline_pages_are_valid_urls() {
        assert!(SPLASH_PAGE.parse::<tauri::Url>().is_ok());
        for error in [BootError::NodeMissing, BootError::ServerMissing, BootError::ServerFailed] {
            assert!(error.page().parse::<tauri::Url>().is_ok());
        }
    }

    #[test]
    fn finds_bundled_resources_under_their_relative_path() {
        let root = std::env::temp_dir().join(format!("helicon-res-{}", std::process::id()));
        std::fs::create_dir_all(root.join("resources")).unwrap();
        std::fs::write(root.join("resources").join("server.cjs"), "").unwrap();
        assert_eq!(find_resource(&root, "server.cjs"), Some(root.join("resources").join("server.cjs")));
        assert_eq!(find_resource(&root, "missing.cjs"), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn finds_the_bundled_node_beside_the_executable() {
        let dir = std::env::temp_dir().join(format!("helicon-sidecar-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(bundled_node_in(&dir), None);
        let name = if cfg!(windows) { "node.exe" } else { "node" };
        std::fs::write(dir.join(name), "").unwrap();
        assert_eq!(bundled_node_in(&dir), Some(dir.join(name)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn keeps_the_server_port_between_launches_while_it_is_free() {
        let dir = std::env::temp_dir().join(format!("helicon-port-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let first = stable_port(Some(&dir));
        assert_ne!(first, 0);
        assert_eq!(stable_port(Some(&dir)), first);
        let held = TcpListener::bind(("127.0.0.1", first)).unwrap();
        let moved = stable_port(Some(&dir));
        assert_ne!(moved, first, "a taken port is replaced");
        drop(held);
        assert_eq!(stable_port(Some(&dir)), moved, "and the replacement is remembered");
        let fresh = fresh_port(Some(&dir));
        assert_eq!(std::fs::read_to_string(dir.join(PORT_FILE)).unwrap(), fresh.to_string());
        assert_ne!(stable_port(None), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn stable_file_drafts_survive_a_fresh_dir_with_backup() {
        // Cópia descartável: nunca toca nos dados reais do app.
        let dir = std::env::temp_dir().join(format!("helicon-drafts-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(load_drafts_from(&dir), None);
        let first = r##"{"proj\nREADME.md":{"content":"# rascunho","baseMtimeMs":100}}"##;
        save_drafts_to(&dir, first).unwrap();
        assert_eq!(load_drafts_from(&dir).as_deref(), Some(first));
        let second = r##"{"proj\nREADME.md":{"content":"# rascunho 2","baseMtimeMs":100}}"##;
        save_drafts_to(&dir, second).unwrap();
        assert_eq!(load_drafts_from(&dir).as_deref(), Some(second));
        assert_eq!(
            std::fs::read_to_string(dir.join(super::DRAFTS_BACKUP_FILE)).unwrap(),
            first,
            "a versão anterior fica em .bak para restauração manual",
        );
        save_drafts_to(&dir, "{}").unwrap();
        assert_eq!(load_drafts_from(&dir), None, "descartar limpa a cópia");
        assert!(dir.join(super::DRAFTS_BACKUP_FILE).exists(), "o backup sobrevive ao descarte");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn remote_ui_may_invoke_the_drafts_vault_commands() {
        // BUG-V1-F6: a UI é servida pelo servidor local em http://127.0.0.1:*, que o
        // Tauri trata como conteúdo remoto. Comando do app sem concessão explícita é
        // negado em origem remota, o frontend engole a recusa e o cofre nunca é usado
        // no instalador (só o localStorage da origem, que se perde na troca de porta).
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let build = std::fs::read_to_string(root.join("build.rs")).unwrap();
        let caps: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(root.join("capabilities").join("main.json")).unwrap(),
        )
        .unwrap();
        let permissions = caps["permissions"].as_array().unwrap();
        for cmd in ["helicon_load_file_drafts", "helicon_save_file_drafts"] {
            assert!(
                build.contains(cmd),
                "build.rs deve declarar {cmd} no AppManifest para gerar o allow-*"
            );
            let allow = format!("allow-{}", cmd.replace('_', "-"));
            assert!(
                permissions.iter().any(|p| p.as_str() == Some(allow.as_str())),
                "capabilities/main.json deve conceder {allow} (comandos gerados em kebab-case)"
            );
        }
        let urls = caps["remote"]["urls"].as_array().unwrap();
        assert!(
            urls.iter().any(|u| u.as_str() == Some("http://127.0.0.1:*")),
            "a concessão precisa valer para o servidor local em qualquer porta"
        );
    }

    #[test]
    fn retries_on_a_fresh_port_only_when_the_server_exits_at_once() {
        // Outro processo pegou a porta verificada antes de o servidor ligá-la: o servidor sai, a nova tentativa pousa.
        let mut tried = Vec::new();
        let started = start_with_retry(4100, || 4200, |port| {
            tried.push(port);
            if port == 4100 {
                Err(StartFailure::Exited)
            } else {
                Ok(port)
            }
        });
        assert_eq!(started.ok(), Some(4200));
        assert_eq!(tried, vec![4100, 4200]);

        // Um servidor que nunca responde não é ajudado por outra porta.
        let mut tried = Vec::new();
        let hung = start_with_retry(4100, || 4200, |port| {
            tried.push(port);
            Err::<u16, _>(StartFailure::Failed)
        });
        assert!(matches!(hung, Err(BootError::ServerFailed)));
        assert_eq!(tried, vec![4100]);

        // Duas saídas seguidas desistem em vez de entrar em loop.
        let mut tried = Vec::new();
        let gone = start_with_retry(4100, || 4200, |port| {
            tried.push(port);
            Err::<u16, _>(StartFailure::Exited)
        });
        assert!(gone.is_err());
        assert_eq!(tried, vec![4100, 4200]);
    }

    #[cfg(unix)]
    #[test]
    fn shell_probe_answers_come_from_the_last_path_line() {
        let root = std::env::temp_dir().join(format!("helicon-probe-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let node = root.join("node");
        std::fs::write(&node, "").unwrap();
        // Arquivos rc imprimem acima da resposta; uma instalação removida pode restar abaixo de nada.
        let output = format!("Welcome back\n{}\n", node.display());
        assert_eq!(select_probe_path(&output), Some(node.clone()));
        assert_eq!(select_probe_path("Welcome back\n"), None);
        assert_eq!(select_probe_path("/no/such/node-here\n"), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn well_known_homes_only_list_installs_that_exist() {
        let home = std::env::temp_dir().join(format!("helicon-home-{}", std::process::id()));
        std::fs::create_dir_all(home.join(".volta/bin")).unwrap();
        std::fs::write(home.join(".volta/bin/node"), "").unwrap();
        let nodes = well_known_nodes_in(&home);
        assert!(nodes.contains(&home.join(".volta/bin/node")));
        assert!(!nodes.contains(&home.join(".asdf/shims/node")));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[cfg(unix)]
    #[test]
    fn nvm_resolves_to_the_newest_installed_version() {
        let home = std::env::temp_dir().join(format!("helicon-nvm-{}", std::process::id()));
        for version in ["v18.20.4", "v20.11.0", "v20.9.0"] {
            let dir = home.join(".nvm/versions/node").join(version).join("bin");
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("node"), "").unwrap();
        }
        std::fs::create_dir_all(home.join(".nvm/versions/node/junk")).unwrap();
        let node = latest_nvm_node(&home).unwrap();
        assert!(node.ends_with(".nvm/versions/node/v20.11.0/bin/node"), "got {node:?}");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[cfg(unix)]
    #[test]
    fn path_augmentation_prepends_without_duplicating() {
        use std::ffi::OsString;
        let prepend = [PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/usr/local/bin")];
        assert_eq!(
            prepend_to_path(&prepend, Some(OsString::from("/usr/bin:/bin"))),
            OsString::from("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
        );
        assert_eq!(
            prepend_to_path(&prepend, Some(OsString::from("/usr/local/bin:/usr/bin"))),
            OsString::from("/opt/homebrew/bin:/usr/local/bin:/usr/bin")
        );
        assert_eq!(prepend_to_path(&prepend, None), OsString::from("/opt/homebrew/bin:/usr/local/bin"));
    }
}
