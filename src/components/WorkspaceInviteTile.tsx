/**
 * Workspace identity tile shared by the invite surfaces (the live
 * WorkspaceInviteToast and the switcher's PendingInvitesBanner) so an
 * invitation looks the same wherever it appears: the workspace avatar when
 * it has one, otherwise a gradient tile keyed to the name with its initial.
 */

/** Stable hue for a workspace without an avatar, so the same workspace
 *  always gets the same tile colour across sessions and surfaces. */
export function hueFor(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

const SIZES = {
  sm: { box: "h-9 w-9 rounded-lg", text: "text-sm" },
  lg: { box: "h-12 w-12 rounded-xl", text: "text-lg" },
} as const;

export function WorkspaceTile({
  name,
  avatarUrl,
  size = "lg",
}: {
  name: string;
  avatarUrl?: string | null;
  size?: keyof typeof SIZES;
}) {
  const s = SIZES[size];
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        draggable={false}
        className={`${s.box} shrink-0 object-cover ring-1 ring-border`}
      />
    );
  }
  const hue = hueFor(name);
  return (
    <div
      aria-hidden
      className={`${s.box} ${s.text} flex shrink-0 items-center justify-center font-semibold text-white shadow-inner`}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 70% 42%))`,
      }}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </div>
  );
}
