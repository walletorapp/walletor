import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ConceptRail } from "./ConceptRail";

describe("ConceptRail", () => {
  it("places Trenches directly below Swap on desktop and mobile", () => {
    render(
      <MemoryRouter>
        <ConceptRail mobileOpen={false} onMobileClose={vi.fn()} />
      </MemoryRouter>,
    );

    const navigation = screen.getByRole("navigation", {
      name: "Concept sections",
    });
    const entries = within(navigation).getAllByRole("button");

    expect(entries.slice(0, 3).map((entry) => entry.textContent)).toEqual([
      "Swap",
      "Trenches",
      "Claims",
    ]);
    const mobileNavigation = screen.getByRole("navigation", {
      name: "Walletor mobile navigation",
    });
    const mobileEntries = within(mobileNavigation).getAllByRole("link");
    expect(mobileEntries.slice(0, 3).map((entry) => entry.textContent)).toEqual(
      ["Swap", "Trenches", "Claims"],
    );
    expect(mobileEntries[1]).toHaveAttribute("href", "/trenches");
    expect(
      within(navigation)
        .getByRole("button", { name: "Claims" })
        .querySelector(".concept-rail-item__signal"),
    ).toBeInTheDocument();
    expect(
      within(navigation).queryByRole("button", { name: "Tools" }),
    ).not.toBeInTheDocument();
  });
});
