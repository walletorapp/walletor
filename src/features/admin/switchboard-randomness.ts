export async function loadSwitchboardRandomnessClient() {
  const { AnchorUtils, Randomness } =
    await import("@switchboard-xyz/on-demand");
  return { AnchorUtils, Randomness };
}
