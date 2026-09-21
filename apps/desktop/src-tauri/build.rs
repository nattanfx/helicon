fn main() {
    // BUG-V1-F6: a UI do desktop é servida pelo servidor local em http://127.0.0.1:*,
    // que o Tauri trata como conteúdo remoto. Comandos do app são negados a origem
    // remota sem concessão explícita, e o frontend engole a recusa em silêncio —
    // o cofre nunca era usado no instalador. Declarar os comandos gera as permissões
    // `allow-*`, concedidas em capabilities/main.json para a origem do servidor.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new()
                .commands(&["helicon_load_file_drafts", "helicon_save_file_drafts"]),
        ),
    )
    .expect("falha ao rodar tauri-build");
}
