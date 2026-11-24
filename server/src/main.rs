use affinmail_server::{create_app, state::AppState};
use std::net::SocketAddr;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(2087);

    let state = AppState::new();
    tokio::spawn(affinmail_server::stats::run_collector());
    let app = create_app(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("============================================================");
    println!("      AffinMail 100% Native Rust Backend Server             ");
    println!("   Zero PHP - Zero Docker - High-Performance Sovereign     ");
    println!("============================================================");
    println!("Listening on: http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
