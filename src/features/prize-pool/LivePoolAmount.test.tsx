import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LivePoolAmount } from "./LivePoolAmount";

let frame: FrameRequestCallback | undefined;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => {
  frame = undefined;
  vi.unstubAllGlobals();
});

it("shows the initial verified value without a reward animation", () => {
  render(<LivePoolAmount microUsd="1570000" display="cents" roundId="a" />);
  expect(screen.getByText("$1.57")).not.toHaveClass(
    "live-pool-amount__value--growing",
  );
  expect(frame).toBeUndefined();
});

it("counts up and pulses on increases, without replaying on identical refreshes", () => {
  const view = render(
    <LivePoolAmount microUsd="1570000" display="cents" roundId="a" />,
  );
  view.rerender(
    <LivePoolAmount microUsd="1820000" display="cents" roundId="a" />,
  );
  expect(screen.getByText("$1.57")).toHaveClass(
    "live-pool-amount__value--growing",
  );
  act(() => frame?.(0));
  act(() => frame?.(450));
  expect(screen.queryByText("$1.57")).not.toBeInTheDocument();
  act(() => frame?.(900));
  const value = screen.getByText("$1.82");
  view.rerender(
    <LivePoolAmount microUsd="1820000" display="cents" roundId="a" />,
  );
  expect(screen.getByText("$1.82")).toBe(value);
});

it("resets immediately on decreases and new rounds", () => {
  const view = render(
    <LivePoolAmount microUsd="1570000" display="cents" roundId="a" />,
  );
  view.rerender(
    <LivePoolAmount microUsd="10000" display="cents" roundId="a" />,
  );
  expect(screen.getByText("$0.01")).not.toHaveClass(
    "live-pool-amount__value--growing",
  );
  view.rerender(
    <LivePoolAmount microUsd="2000000" display="cents" roundId="b" />,
  );
  expect(screen.getByText("$2.00")).not.toHaveClass(
    "live-pool-amount__value--growing",
  );
});

it("respects reduced motion and cancels an interrupted count-up", () => {
  const view = render(<LivePoolAmount microUsd="1570000" display="cents" />);
  view.rerender(<LivePoolAmount microUsd="1820000" display="cents" />);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  view.rerender(<LivePoolAmount microUsd="2000000" display="cents" />);
  expect(cancelAnimationFrame).toHaveBeenCalled();
  expect(screen.getByText("$2.00")).not.toHaveClass(
    "live-pool-amount__value--growing",
  );
});
