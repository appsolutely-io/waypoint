import { createRoot } from "react-dom/client";
import { ConfigProvider, theme } from "antd";
import { useHostTokens } from "../../src/skin-antd/skin";

const params = new URLSearchParams(location.search);
function StatusColors() {
  const { tokens } = useHostTokens();
  return (
    <main
      style={{
        fontFamily: tokens.fontFamily,
        fontSize: tokens.fontSize,
        color: tokens.foreground,
        background: tokens.background,
        padding: tokens.space,
      }}
    >
      <h1>Status colors</h1>
      <p data-danger="background" style={{ color: tokens.danger }}>
        This action could not be completed.
      </p>
      <div style={{ background: tokens.surface, padding: tokens.space }}>
        <p data-danger="surface" style={{ color: tokens.danger }}>
          This action could not be completed.
        </p>
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <ConfigProvider
    theme={{
      algorithm:
        params.get("scheme") === "dark"
          ? theme.darkAlgorithm
          : theme.defaultAlgorithm,
      token: params.has("grey")
        ? { colorBgContainer: "#c8c8c8", colorBgLayout: "#c8c8c8" }
        : undefined,
    }}
  >
    <StatusColors />
  </ConfigProvider>,
);
