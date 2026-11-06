// @vitest-environment jsdom
// The antd drawer adapter names its close control on every supported antd
// version. Here antd's Drawer is replaced by one with the 5.0.0 header
// contract (antd/components/drawer/DrawerPanel.tsx at tag 5.0.0): a boolean
// `closable`, a close button always named "Close", and an `extra` slot.
// Its panel does not forward ARIA naming props.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("antd", async (importActual) => {
  const actual = await importActual<typeof import("antd")>();
  function Drawer({
    title,
    extra,
    closable = true,
    onClose,
    children,
  }: {
    title?: ReactNode;
    extra?: ReactNode;
    closable?: boolean;
    onClose?: () => void;
    children?: ReactNode;
  }) {
    if (typeof closable !== "boolean")
      throw new Error("antd 5.0.0 takes a boolean closable");
    return (
      <div role="dialog">
        <div className="ant-drawer-header">
          <div className="ant-drawer-header-title">
            {closable && (
              <button type="button" onClick={onClose} aria-label="Close">
                x
              </button>
            )}
            {title && <div className="ant-drawer-title">{title}</div>}
          </div>
          {extra && <div className="ant-drawer-extra">{extra}</div>}
        </div>
        {children}
      </div>
    );
  }
  return { ...actual, Drawer };
});
afterEach(cleanup);

describe("the antd drawer on the lowest supported antd", () => {
  it("CK-L1a-min its one close control is named by the chat and closes", async () => {
    const { antdPrimitives } = await import("../../src/skin-antd/index");
    const D = antdPrimitives.drawer;
    const onClose = vi.fn();
    const { rerender } = render(
      <D open label="Title" closeLabel="关闭" onClose={onClose}>
        <p>Body</p>
      </D>,
    );
    expect(screen.getByRole("dialog", { name: "Title" })).toBeDefined();
    rerender(
      <D open label="Updated title" closeLabel="关闭" onClose={onClose}>
        <p>Body</p>
      </D>,
    );
    expect(screen.getByRole("dialog", { name: "Updated title" })).toBeDefined();
    const closes = screen
      .getAllByRole("button")
      .filter((button) =>
        /close|关闭/i.test(button.getAttribute("aria-label") ?? ""),
      );
    expect(closes.map((button) => button.getAttribute("aria-label"))).toEqual([
      "关闭",
    ]);
    fireEvent.click(closes[0]!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
