import { createRoot } from "react-dom/client";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { ConfigProvider, theme as antdTheme } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import {
  WaypointChat,
  WaypointProvider,
  FormFillFields,
  FormFillPopup,
  themeProperties,
  lightTheme,
  darkTheme,
} from "../src/react/index";
import { antdSkin } from "../src/skin-antd/index";
import { choices, readView, type View } from "./state";
import { createPreview, type Preview } from "./scenarios";
import "../src/react/styles.css";
import "./styles.css";

import { previewCopy } from "./copy";
import { statePlanLabels } from "./reply-states";

const preference = matchMedia("(prefers-color-scheme: dark)");
const subscribe = (changed: () => void) => {
  preference.addEventListener("change", changed);
  return () => preference.removeEventListener("change", changed);
};
function PreviewSurface({ view, preview }: { view: View; preview: Preview }) {
  const copy = previewCopy(view.lang);
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<string>();
  const props = {
    client: preview.client,
    ...(view.skin === "antd" ? antdSkin : {}),
    locale: view.lang,
    dir: view.dir,
    planLabels: statePlanLabels(view.lang),
    ...(view.scheme === "system" ? {} : { colorScheme: view.scheme }),
  };
  if (preview.form)
    return (
      <WaypointProvider {...props}>
        <section
          className="preview-form waypoint"
          lang={view.lang}
          dir={view.dir}
          aria-labelledby="form-heading"
        >
          <h2 id="form-heading">{copy.formHeading}</h2>
          <p>{copy.formHint}</p>
          <FormFillFields
            session={preview.form}
            onRegenerate={(name) => {
              setField(name);
              setOpen(true);
            }}
          />
          <FormFillPopup
            session={preview.form}
            source={preview.source}
            field={field}
            open={open}
            onClose={() => setOpen(false)}
          />
        </section>
      </WaypointProvider>
    );
  return <WaypointChat {...props} layout={view.layout} />;
}

function Scenario({ view }: { view: View }) {
  const copy = previewCopy(view.lang);
  const [preview, setPreview] = useState<Preview>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    let resource: Preview | undefined;
    setFailed(false);
    setPreview(undefined);
    void createPreview(view.scenario, view.lang, view.state).then(
      (value) => {
        resource = value;
        if (live) setPreview(value);
        else value.dispose();
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
      resource?.dispose();
    };
  }, [view.scenario, view.state, attempt]);
  useEffect(() => {
    void preview?.setLanguage(view.lang).catch(() => setFailed(true));
  }, [preview, view.lang]);
  if (failed)
    return (
      <div className="preview-status" role="alert">
        <p>{copy.failed}</p>
        <button onClick={() => setAttempt((value) => value + 1)}>
          {copy.retry}
        </button>
      </div>
    );
  if (!preview)
    return (
      <p className="preview-status" role="status">
        {copy.loading}
      </p>
    );
  return <PreviewSurface key={view.skin} view={view} preview={preview} />;
}

function App() {
  const [view, setView] = useState(() => readView(location.search));
  const copy = previewCopy(view.lang);
  useEffect(() => {
    document.title = `Waypoint ${copy.playground}`;
    document.documentElement.lang = view.lang;
  }, [copy, view.lang]);
  const dark = useSyncExternalStore(subscribe, () => preference.matches);
  const scheme =
    view.scheme === "system" ? (dark ? "dark" : "light") : view.scheme;
  useEffect(() => {
    const restore = () => setView(readView(location.search));
    addEventListener("popstate", restore);
    return () => removeEventListener("popstate", restore);
  }, []);
  const change = (key: keyof View, value: string) => {
    const url = new URL(location.href);
    url.searchParams.set(key, value);
    history.pushState(null, "", url);
    setView(readView(url.search));
  };
  const content = (
    <div
      className="playground"
      dir={view.dir}
      data-scheme={scheme}
      style={
        {
          ...themeProperties(scheme === "dark" ? darkTheme : lightTheme),
          colorScheme: scheme,
        } as CSSProperties
      }
    >
      <header className="preview-toolbar">
        <h1>
          Waypoint <span>{copy.playground}</span>
        </h1>
        <div
          className="preview-controls"
          role="group"
          aria-label={copy.settings}
        >
          {(
            [
              "scenario",
              "state",
              "skin",
              "scheme",
              "layout",
              "dir",
              "lang",
            ] as const
          ).map((key) => (
            <label key={key} htmlFor={`preview-${key}`}>
              {copy.labels[key]}
              <select
                id={`preview-${key}`}
                value={view[key]}
                onChange={(event) => change(key, event.target.value)}
              >
                {choices[key].map((value) => (
                  <option key={value} value={value}>
                    {copy.names[value]}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </header>
      <main
        className="preview-stage"
        data-layout={view.layout}
        aria-label={copy.names[view.scenario]}
      >
        <Scenario key={`${view.scenario}:${view.state}`} view={view} />
      </main>
    </div>
  );
  return (
    <ConfigProvider
      direction={view.dir}
      locale={view.lang === "zh-CN" ? zhCN : enUS}
      theme={{
        algorithm:
          scheme === "dark"
            ? antdTheme.darkAlgorithm
            : antdTheme.defaultAlgorithm,
      }}
    >
      {content}
    </ConfigProvider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
