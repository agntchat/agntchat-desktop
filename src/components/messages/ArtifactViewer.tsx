import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronUp,
  History,
  Loader2,
  Maximize2,
  MessageSquare,
  Minimize2,
  RotateCcw,
  Send,
  X,
} from "lucide-react";
import { cn, formatRelativeShort } from "../../lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MarkdownContent } from "./MarkdownContent";
import { ArtifactKindIcon } from "./ArtifactCard";
import { ResizeHandle } from "../ResizeHandle";
import { useArtifactPaneWidth } from "../../hooks/useResizableWidth";
import {
  getArtifact,
  getArtifactVersion,
  listArtifactVersions,
  type Artifact,
  type ArtifactComment,
  type ArtifactKind,
  type ArtifactVersion,
} from "../../lib/api";
import { useArtifactStore } from "../../stores/artifactStore";
import { useChatStore } from "../../stores/chatStore";
import { ws } from "../../services/websocket";

const EMPTY_COMMENTS: ArtifactComment[] = [];
const EMPTY_ARTIFACTS: Artifact[] = [];

function kindKey(kind: ArtifactKind): string {
  switch (kind) {
    case "code":
      return "kindCode";
    case "html":
      return "kindHtml";
    case "markdown":
      return "kindMarkdown";
    case "text":
      return "kindText";
    default:
      return "kindDocument";
  }
}

function formatVersionTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Renders artifact content by kind. Markdown + document use the shared
 *  markdown renderer; code/html show a monospace scrollable block (html as
 *  raw source, matching mobile — never injected into the DOM); plain text
 *  renders with preserved whitespace. */
function ArtifactContent({
  kind,
  content,
}: {
  kind: ArtifactKind;
  content: string;
}) {
  if (kind === "markdown" || kind === "document") {
    return <MarkdownContent content={content} />;
  }
  if (kind === "code" || kind === "html") {
    return (
      <pre className="overflow-x-auto text-[12px] leading-relaxed text-foreground">
        <code>{content}</code>
      </pre>
    );
  }
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
      {content}
    </p>
  );
}

/**
 * Full artifact viewer — a right-docked side pane opened from an inline
 * ArtifactCard (store-driven; MessagesView renders it in the right-pane slot,
 * taking precedence over the huddle / details panes like a huddle does over
 * details). Same resizable-width chrome as HuddleSidePane /
 * ConversationDetailsPanel. Shows the current version's content rendered by
 * kind, a collapsible version history (any prior version viewable read-only),
 * and a live comment thread with composer. Mirrors web's ArtifactViewer.
 */
export function ArtifactViewer() {
  const { t } = useTranslation("artifacts");
  const viewer = useArtifactStore((s) => s.viewer);
  const closeViewer = useArtifactStore((s) => s.closeViewer);
  const setViewerExpanded = useArtifactStore((s) => s.setViewerExpanded);
  const openViewer = useArtifactStore((s) => s.openViewer);
  // Full-screen reading mode: the same header / body / composer rendered in a
  // window-filling overlay (reading column capped for line length) instead of
  // the docked pane.
  const expanded = viewer?.expanded ?? false;

  // Own width (not the shared right-pane key): a reading pane is dragged
  // wider than details ever would be, with a ceiling that grows with the
  // window.
  const {
    width,
    ref: paneRef,
    resizing,
    onResizeStart,
    onResizeReset,
  } = useArtifactPaneWidth();

  const artifactId = viewer?.artifactId;
  const conversationId = viewer?.conversationId;

  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [versions, setVersions] = useState<ArtifactVersion[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<ArtifactVersion | null>(null);

  const comments = useArtifactStore((s) =>
    artifactId ? s.comments[artifactId] ?? EMPTY_COMMENTS : EMPTY_COMMENTS
  );
  // Full screen lists every artifact in the conversation down the left so
  // the reader can jump between them without leaving the overlay.
  const siblings = useArtifactStore((s) =>
    conversationId ? s.artifacts[conversationId] ?? EMPTY_ARTIFACTS : EMPTY_ARTIFACTS
  );
  useEffect(() => {
    if (!expanded || !conversationId) return;
    useArtifactStore.getState().fetchArtifactsIfNeeded(conversationId).catch(() => {});
  }, [expanded, conversationId]);

  const [commentBody, setCommentBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [commentError, setCommentError] = useState(false);

  // Author name resolution from the conversation's member list (already in
  // the chat store — the viewer only opens from an open conversation).
  const members = useChatStore((s) =>
    conversationId
      ? (
          s.conversations.find((c) => c.id === conversationId) ??
          s.agentConversations.find((c) => c.id === conversationId)
        )?.members
      : undefined
  );
  const memberInfo = useMemo(() => {
    const map: Record<string, { name: string; avatarUrl?: string; isAgent: boolean }> = {};
    for (const m of members ?? []) {
      if (m.participant) {
        map[m.participantId] = {
          name: m.participant.displayName,
          avatarUrl: m.participant.avatarUrl,
          isAgent: m.participant.type === "agent",
        };
      }
    }
    return map;
  }, [members]);

  // --- Load artifact + versions + comments when the viewer opens ---
  const load = useCallback(() => {
    if (!artifactId) return;
    setLoading(true);
    setError(null);
    getArtifact(artifactId)
      .then((a) => {
        setArtifact(a);
        useArtifactStore.getState().upsertArtifact(a);
      })
      .catch((e: Error) => setError(e.message || t("loadFailed")))
      .finally(() => setLoading(false));
  }, [artifactId, t]);

  useEffect(() => {
    if (!artifactId) return;
    setArtifact(null);
    setVersions([]);
    setSelectedVersion(null);
    setHistoryOpen(false);
    setCommentBody("");
    setCommentError(false);
    load();
    useArtifactStore.getState().fetchComments(artifactId).catch(() => {});
    listArtifactVersions(artifactId).then(setVersions).catch(() => {});
  }, [artifactId, load]);

  // --- Live: follow edits + new comments while open. The conversation's
  // channel is joined (the viewer opens from within it); the store handles
  // the global merge, this keeps the local full-content copy fresh. ---
  useEffect(() => {
    if (!artifactId) return;
    const unsubUpdated = ws.on("conv:artifact_updated", (payload) => {
      const updated = payload as unknown as Artifact;
      if (updated.id !== artifactId) return;
      // Preserve `current` if the payload omits it so a contentless update
      // broadcast can't blank out already-loaded content. A reader pinned to
      // an OLDER version keeps their selectedVersion override untouched.
      setArtifact((cur) =>
        cur && cur.id === artifactId
          ? { ...cur, ...updated, current: updated.current ?? cur.current }
          : cur
      );
      listArtifactVersions(artifactId).then(setVersions).catch(() => {});
    });
    return unsubUpdated;
  }, [artifactId]);

  // Escape steps back one level: full screen → docked pane → closed (the
  // comment draft is intentionally ephemeral, like mobile).
  useEffect(() => {
    if (!viewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (expanded) setViewerExpanded(false);
      else closeViewer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewer, expanded, setViewerExpanded, closeViewer]);

  const handleSelectVersion = useCallback(
    (v: ArtifactVersion) => {
      if (!artifactId) return;
      if (artifact && v.version === artifact.currentVersion) {
        setSelectedVersion(null);
        return;
      }
      if (typeof v.content === "string") {
        setSelectedVersion(v);
      } else {
        getArtifactVersion(artifactId, v.version)
          .then(setSelectedVersion)
          .catch(() => {});
      }
    },
    [artifactId, artifact]
  );

  const handlePostComment = useCallback(() => {
    const body = commentBody.trim();
    if (!body || !artifactId || posting) return;
    setPosting(true);
    setCommentError(false);
    useArtifactStore
      .getState()
      .postComment(artifactId, body)
      .then(() => setCommentBody(""))
      .catch(() => setCommentError(true))
      .finally(() => setPosting(false));
  }, [commentBody, artifactId, posting]);

  if (!viewer) return null;

  const viewingOlder =
    artifact != null &&
    selectedVersion != null &&
    selectedVersion.version !== artifact.currentVersion;
  const shownVersion = viewingOlder ? selectedVersion! : artifact?.current;
  const content = shownVersion?.content ?? "";
  const author = artifact ? memberInfo[artifact.authorId] : undefined;

  const panel = (
    <>
      {/* Header — mirrors the huddle pane's label + title + close layout. */}
      <header
        className={cn(
          "relative flex h-14 shrink-0 items-center gap-3 bg-card px-4 after:absolute after:bottom-0 after:left-4 after:right-4 after:h-px after:bg-border",
          expanded && "px-8 after:left-8 after:right-8"
        )}
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/15">
          <ArtifactKindIcon kind={artifact?.kind ?? "document"} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("badge")}
            {artifact
              ? ` · ${t("versionShort", { version: artifact.currentVersion })}`
              : ""}
          </p>
          <p className="truncate text-sm font-semibold text-foreground">
            {artifact ? artifact.title?.trim() || t("untitled") : t("screenTitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setViewerExpanded(!expanded)}
          aria-label={expanded ? t("exitFullscreen") : t("fullscreen")}
          title={expanded ? t("exitFullscreen") : t("fullscreen")}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={closeViewer}
          aria-label={t("common:close")}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {/* Body — in full screen the reading column is capped so long
          documents keep a comfortable measure on wide windows. */}
      <div className={cn("flex-1 overflow-y-auto px-4 py-4", expanded && "px-8 py-8")}>
        <div className={cn(expanded && "mx-auto w-full max-w-4xl")}>
          {loading && !artifact && (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && !artifact && (
            <div className="flex flex-col items-center gap-2 py-12">
              <p className="text-sm text-muted-foreground">{error}</p>
              <button
                type="button"
                onClick={load}
                className="text-sm font-semibold text-primary hover:underline"
              >
                {t("common:retry")}
              </button>
            </div>
          )}

          {artifact && (
            <>
              <p className="mb-3 text-xs text-muted-foreground">
                {t(kindKey(artifact.kind))}
                {author ? ` · ${t("by", { name: author.name })}` : ""}
                {" · "}
                {t("edited", {
                  time: formatRelativeShort(artifact.updatedAt || artifact.insertedAt),
                })}
              </p>

              {viewingOlder && (
                <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-border bg-primary/10 px-3 py-2">
                  <span className="text-xs font-semibold text-foreground">
                    {t("viewingOlder", {
                      version: selectedVersion!.version,
                      total: artifact.currentVersion,
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedVersion(null)}
                    className="flex shrink-0 items-center gap-1 text-xs font-bold text-primary hover:underline"
                  >
                    <RotateCcw className="h-3 w-3" />
                    {t("backToLatest")}
                  </button>
                </div>
              )}

              {/* Content */}
              <div
                className={cn(
                  "rounded-xl border border-border bg-muted/30 p-4",
                  expanded && "p-8"
                )}
              >
                <ArtifactContent kind={artifact.kind} content={content} />
              </div>

              {/* Version history */}
              <button
                type="button"
                onClick={() => setHistoryOpen((v) => !v)}
                className="mt-5 flex w-full items-center gap-2 border-b border-border pb-2 text-left"
              >
                <History className="h-4 w-4 text-foreground" />
                <span className="text-sm font-bold text-foreground">
                  {t("versionHistory")}
                </span>
                <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-bold text-muted-foreground">
                  {versions.length || artifact.currentVersion}
                </span>
                <span className="flex-1" />
                {historyOpen ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              {historyOpen &&
                versions.map((v) => {
                  const isCurrent = v.version === artifact.currentVersion;
                  const isSelected = viewingOlder && selectedVersion!.version === v.version;
                  const vAuthor = memberInfo[v.authorId];
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => handleSelectVersion(v)}
                      className={cn(
                        "flex w-full gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent",
                        (isSelected || (isCurrent && !viewingOlder)) && "bg-primary/10"
                      )}
                    >
                      <span className="w-9 shrink-0 text-xs font-bold text-primary">
                        {t("versionShort", { version: v.version })}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        {v.changeNote ? (
                          <span className="line-clamp-2 text-sm text-foreground">
                            {v.changeNote}
                          </span>
                        ) : (
                          <span className="text-sm italic text-muted-foreground">
                            {t("noChangeNote")}
                          </span>
                        )}
                        <span className="truncate text-[11px] text-muted-foreground">
                          {vAuthor ? `${vAuthor.name} · ` : ""}
                          {formatVersionTime(v.insertedAt)}
                          {isCurrent ? ` · ${t("latest")}` : ""}
                        </span>
                      </span>
                    </button>
                  );
                })}

              {/* Comments */}
              <div className="mt-5 flex items-center gap-2 border-b border-border pb-2">
                <MessageSquare className="h-4 w-4 text-foreground" />
                <span className="text-sm font-bold text-foreground">{t("comments")}</span>
                {comments.length > 0 && (
                  <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-bold text-muted-foreground">
                    {comments.length}
                  </span>
                )}
              </div>
              {comments.length === 0 ? (
                <p className="mt-3 text-sm italic text-muted-foreground">
                  {t("noComments")}
                </p>
              ) : (
                comments.map((c) => {
                  const cAuthor = memberInfo[c.authorId];
                  return (
                    <div key={c.id} className="mt-3 flex gap-2.5">
                      <Avatar size="sm" className="mt-0.5">
                        {cAuthor?.avatarUrl && (
                          <AvatarImage src={cAuthor.avatarUrl} />
                        )}
                        <AvatarFallback className="text-[10px]">
                          {(cAuthor?.name || "?").slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1 rounded-lg border border-border bg-muted/30 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-bold text-foreground">
                            {cAuthor?.name || t("unknownAuthor")}
                          </span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {formatRelativeShort(c.insertedAt)}
                          </span>
                        </div>
                        <p className="mt-0.5 whitespace-pre-wrap text-sm leading-snug text-foreground">
                          {c.body}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>
      </div>

      {/* Comment composer */}
      {artifact && (
        <div className={cn("border-t border-border bg-card px-4 py-3", expanded && "px-8")}>
          <div className={cn(expanded && "mx-auto w-full max-w-4xl")}>
            {commentError && (
              <p className="mb-1.5 text-xs text-destructive">{t("commentFailed")}</p>
            )}
            <div className="flex items-end gap-2">
              <textarea
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handlePostComment();
                  }
                }}
                placeholder={t("commentPlaceholder")}
                rows={1}
                disabled={posting}
                className="max-h-24 min-h-[38px] flex-1 resize-none rounded-2xl border border-border bg-muted/30 px-3.5 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
              />
              <button
                type="button"
                onClick={handlePostComment}
                disabled={!commentBody.trim() || posting}
                aria-label={t("post")}
                className="flex h-[38px] w-[46px] shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
              >
                {posting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  if (expanded) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("screenTitle")}
        className="fixed inset-0 z-50 flex bg-card"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {siblings.length > 0 && conversationId && (
          <nav
            aria-label={t("inThisChat")}
            className="hidden w-72 shrink-0 flex-col border-r border-border bg-muted/20 md:flex"
          >
            <div className="flex h-14 shrink-0 flex-col justify-center border-b border-border px-4">
              <p className="text-sm font-semibold text-foreground">{t("inThisChat")}</p>
              <p className="text-xs text-muted-foreground">
                {t("count", { count: siblings.length })}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {siblings.map((a) => {
                const active = a.id === artifactId;
                return (
                  <button
                    key={a.id}
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => openViewer(a.id, conversationId, { expanded: true })}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent",
                      active && "bg-primary/10"
                    )}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/15">
                      <ArtifactKindIcon kind={a.kind} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {a.title?.trim() || t("untitled")}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {t(kindKey(a.kind))} ·{" "}
                        {t("versionShort", { version: a.currentVersion })} ·{" "}
                        {t("edited", {
                          time: formatRelativeShort(a.updatedAt || a.insertedAt),
                        })}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>
        )}
        <div className="flex min-w-0 flex-1 flex-col">{panel}</div>
      </div>
    );
  }

  return (
    <>
      <ResizeHandle
        right={width}
        resizing={resizing}
        onResizeStart={onResizeStart}
        onResizeReset={onResizeReset}
        label={t("screenTitle")}
      />
      <aside
        ref={paneRef}
        aria-label={t("screenTitle")}
        className="surface-panel-strong relative z-20 -ml-3 flex h-full shrink-0 flex-col overflow-hidden rounded-l-lg bg-card"
        style={{ width } as React.CSSProperties}
      >
        {panel}
      </aside>
    </>
  );
}
