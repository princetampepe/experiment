import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addComment,
  clearSession,
  createFeedStream,
  createNotificationStream,
  createPost,
  editPost,
  engage,
  followUser,
  getComments,
  getDashboard,
  getMessageInbox,
  getMessageThread,
  getNotifications,
  getPersonalizedFeed,
  getPosts,
  getSuggestedUsers,
  getToken,
  getUnreadNotificationCount,
  login,
  logout,
  markNotificationRead,
  me,
  register,
  sendMessage,
  unfollowUser,
  votePoll,
  markMessageThreadRead,
} from "./api";

const PAGE_SIZE = 10;
const SKELETON_COUNT = 3;
const MOBILE_BREAKPOINT = 760;
const DRAFT_STORAGE_KEY = "pulse_composer_draft_v2";
const MUTE_WORDS_KEY = "pulse_mute_words_v1";

const navItems = [
  "Home",
  "Explore",
  "Notifications",
  "Messages",
  "Bookmarks",
  "Lists",
  "Dashboard",
];

const mobileNavItems = [
  { view: "Home", label: "Home" },
  { view: "Explore", label: "Explore" },
  { view: "Notifications", label: "Alerts" },
  { view: "Dashboard", label: "Stats" },
];

function looksLikeImage(url) {
  return /\.(png|jpg|jpeg|gif|webp|avif|svg)(\?.*)?$/i.test(url || "");
}

function App() {
  const [activeView, setActiveView] = useState("Home");
  const [posts, setPosts] = useState([]);
  const [feedPage, setFeedPage] = useState(0);
  const [feedHasNext, setFeedHasNext] = useState(false);
  const [feedTotal, setFeedTotal] = useState(0);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [compose, setCompose] = useState("");
  const [composeMedia, setComposeMedia] = useState("");
  const [composePollA, setComposePollA] = useState("");
  const [composePollB, setComposePollB] = useState("");
  const [composeParentPostId, setComposeParentPostId] = useState("");
  const [editingPostId, setEditingPostId] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const [mutedWordsInput, setMutedWordsInput] = useState("");
  const [mutedWords, setMutedWords] = useState([]);
  const [feedLivePulse, setFeedLivePulse] = useState(false);
  const [error, setError] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [showPersonalized, setShowPersonalized] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [messageInbox, setMessageInbox] = useState([]);
  const [activeMessagePeerId, setActiveMessagePeerId] = useState(null);
  const [messageThread, setMessageThread] = useState([]);
  const [messageDraft, setMessageDraft] = useState("");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [suggestedUsers, setSuggestedUsers] = useState([]);
  const [commentsByPost, setCommentsByPost] = useState({});
  const [commentDraft, setCommentDraft] = useState({});
  const [authForm, setAuthForm] = useState({
    email: "",
    password: "",
    handle: "",
    displayName: "",
  });
  const [reduceMotion, setReduceMotion] = useState(
    typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const [isMobileViewport, setIsMobileViewport] = useState(
    typeof window !== "undefined" && window.innerWidth <= MOBILE_BREAKPOINT
  );
  const [showMobileInsights, setShowMobileInsights] = useState(false);
  const [viewMotionKey, setViewMotionKey] = useState(0);
  const [revealedPosts, setRevealedPosts] = useState({});
  const [buttonPulse, setButtonPulse] = useState({});
  const [followPulse, setFollowPulse] = useState({});
  const [publishSuccess, setPublishSuccess] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  const loadMoreRef = useRef(null);
  const notificationStreamRef = useRef(null);
  const feedStreamRef = useRef(null);
  const timersRef = useRef([]);
  const charLeft = 280 - compose.length;
  const isFeedView = activeView === "Home" || activeView === "Explore" || activeView === "Bookmarks";

  const scheduleTimeout = useCallback((handler, delayMs) => {
    const timerId = window.setTimeout(handler, delayMs);
    timersRef.current.push(timerId);
    return timerId;
  }, []);

  const triggerToast = useCallback((message) => {
    setToastMessage(message);
    scheduleTimeout(() => {
      setToastMessage("");
    }, 1500);
  }, [scheduleTimeout]);

  const triggerActionPulse = useCallback((postId, action) => {
    const key = `${postId}-${action}`;
    setButtonPulse((prev) => ({ ...prev, [key]: true }));
    scheduleTimeout(() => {
      setButtonPulse((prev) => {
        if (!prev[key]) {
          return prev;
        }
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }, 300);
  }, [scheduleTimeout]);

  const triggerFollowPulse = useCallback((userId) => {
    const key = String(userId);
    setFollowPulse((prev) => ({ ...prev, [key]: true }));
    scheduleTimeout(() => {
      setFollowPulse((prev) => {
        if (!prev[key]) {
          return prev;
        }
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }, 340);
  }, [scheduleTimeout]);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(query), 180);
    return () => clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = (event) => {
      setReduceMotion(event.matches);
    };

    setReduceMotion(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const handleChange = (event) => {
      setIsMobileViewport(event.matches);
    };

    setIsMobileViewport(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => () => {
    timersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    timersRef.current = [];
  }, []);

  useEffect(() => {
    setViewMotionKey((prev) => prev + 1);
  }, [activeView]);

  useEffect(() => {
    if (!isMobileViewport || !isFeedView) {
      setShowMobileInsights(false);
    }
  }, [isMobileViewport, isFeedView]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const storedDraft = window.localStorage.getItem(DRAFT_STORAGE_KEY);
      if (storedDraft) {
        const parsed = JSON.parse(storedDraft);
        setCompose(parsed.compose || "");
        setComposeMedia(parsed.composeMedia || "");
        setComposePollA(parsed.composePollA || "");
        setComposePollB(parsed.composePollB || "");
        setComposeParentPostId(parsed.composeParentPostId || "");
      }
    } catch {
      // Ignore malformed persisted drafts.
    }

    const savedMuteWords = window.localStorage.getItem(MUTE_WORDS_KEY);
    if (savedMuteWords) {
      const words = savedMuteWords
        .split(",")
        .map((word) => word.trim().toLowerCase())
        .filter(Boolean);
      setMutedWords(words);
      setMutedWordsInput(words.join(", "));
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({
        compose,
        composeMedia,
        composePollA,
        composePollB,
        composeParentPostId,
      })
    );
  }, [compose, composeMedia, composePollA, composePollB, composeParentPostId]);

  useEffect(() => {
    if (!isFeedView) {
      return;
    }

    const postsToReveal = activeView === "Bookmarks"
      ? posts.filter((post) => post.bookmarkCount > 0)
      : posts;

    if (reduceMotion) {
      setRevealedPosts((prev) => {
        const next = { ...prev };
        postsToReveal.forEach((post) => {
          next[post.id] = true;
        });
        return next;
      });
      return;
    }

    const cards = document.querySelectorAll(".post-card[data-post-id]");
    if (cards.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }
          const postId = entry.target.getAttribute("data-post-id");
          if (!postId) {
            return;
          }
          setRevealedPosts((prev) => {
            if (prev[postId]) {
              return prev;
            }
            return { ...prev, [postId]: true };
          });
          observer.unobserve(entry.target);
        });
      },
      {
        threshold: 0.14,
        rootMargin: "0px 0px -8% 0px",
      }
    );

    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [activeView, isFeedView, reduceMotion, posts]);

  const loadSidebarData = useCallback(async () => {
    const dashboardData = await getDashboard().catch(() => null);
    setDashboard(dashboardData);

    if (!getToken()) {
      setNotifications([]);
      setUnreadCount(0);
      setSuggestedUsers([]);
      return;
    }

    const [notifData, usersData, unreadData] = await Promise.allSettled([
      getNotifications(),
      getSuggestedUsers(),
      getUnreadNotificationCount(),
    ]);

    setNotifications(notifData.status === "fulfilled" ? notifData.value : []);
    setSuggestedUsers(usersData.status === "fulfilled" ? usersData.value : []);
    setUnreadCount(unreadData.status === "fulfilled" ? (unreadData.value?.count ?? 0) : 0);
  }, []);

  const loadPostsPage = useCallback(
    async (pageToLoad, append) => {
      try {
        if (pageToLoad === 0) {
          setLoading(true);
        } else {
          setLoadingMore(true);
        }

        const fetcher = showPersonalized && currentUser ? getPersonalizedFeed : getPosts;
        const pageData = await fetcher({ query: debouncedQuery, page: pageToLoad, size: PAGE_SIZE });

        setPosts((prev) => (append ? [...prev, ...pageData.items] : pageData.items));
        setFeedPage(pageData.page);
        setFeedHasNext(pageData.hasNext);
        setFeedTotal(pageData.totalElements);
      } catch (err) {
        setError(err.message || "Could not load feed");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [showPersonalized, currentUser, debouncedQuery]
  );

  const loadMessageThreadData = useCallback(async (peerId) => {
    if (!currentUser || !peerId) {
      setMessageThread([]);
      return;
    }

    try {
      const threadData = await getMessageThread(peerId);
      setMessageThread(threadData);
      await markMessageThreadRead(peerId);
      setMessageInbox((prev) => prev.map((item) => (
        item.peerId === peerId ? { ...item, unreadCount: 0 } : item
      )));
    } catch (err) {
      setError(err.message || "Could not load conversation");
    }
  }, [currentUser]);

  const loadMessageInboxData = useCallback(async (preferredPeerId = null) => {
    if (!currentUser) {
      setMessageInbox([]);
      setActiveMessagePeerId(null);
      setMessageThread([]);
      return;
    }

    try {
      setLoadingMessages(true);
      const inboxData = await getMessageInbox();
      setMessageInbox(inboxData);

      const requestedPeer = preferredPeerId ?? activeMessagePeerId;
      const selectedPeer = inboxData.find((item) => item.peerId === requestedPeer)?.peerId
        || inboxData[0]?.peerId
        || null;

      setActiveMessagePeerId(selectedPeer);

      if (selectedPeer) {
        await loadMessageThreadData(selectedPeer);
      } else {
        setMessageThread([]);
      }
    } catch (err) {
      setError(err.message || "Could not load message inbox");
    } finally {
      setLoadingMessages(false);
    }
  }, [currentUser, activeMessagePeerId, loadMessageThreadData]);

  const mergeIncomingPost = useCallback((incomingPost, eventType) => {
    if (!incomingPost || !incomingPost.id) {
      return;
    }

    setPosts((prev) => {
      const existingIndex = prev.findIndex((post) => post.id === incomingPost.id);
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = { ...next[existingIndex], ...incomingPost };
        return next;
      }

      if (eventType === "post_created") {
        return [incomingPost, ...prev].slice(0, 120);
      }
      return prev;
    });

    if (eventType === "post_created") {
      setFeedTotal((prev) => prev + 1);
    }

    setFeedLivePulse(true);
    scheduleTimeout(() => setFeedLivePulse(false), 450);
  }, [scheduleTimeout]);

  const bootstrap = useCallback(async () => {
    try {
      setError("");
      try {
        const meData = await me();
        setCurrentUser(meData);
      } catch {
        clearSession();
        setCurrentUser(null);
      }
      await loadSidebarData();
    } catch (err) {
      setError(err.message || "Could not initialize app");
    }
  }, [loadSidebarData]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    loadPostsPage(0, false);
  }, [loadPostsPage]);

  useEffect(() => {
    if (activeView !== "Messages") {
      return;
    }

    if (!currentUser) {
      setMessageInbox([]);
      setActiveMessagePeerId(null);
      setMessageThread([]);
      return;
    }

    loadMessageInboxData();
  }, [activeView, currentUser, loadMessageInboxData]);

  useEffect(() => {
    if (!isFeedView || !feedHasNext || loading || loadingMore) {
      return undefined;
    }

    const marker = loadMoreRef.current;
    if (!marker) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadPostsPage(feedPage + 1, true);
        }
      },
      { threshold: 0.6 }
    );

    observer.observe(marker);
    return () => observer.disconnect();
  }, [isFeedView, feedHasNext, feedPage, loading, loadingMore, loadPostsPage]);

  useEffect(() => {
    if (!currentUser) {
      if (notificationStreamRef.current) {
        notificationStreamRef.current.close();
        notificationStreamRef.current = null;
      }
      return;
    }

    const source = createNotificationStream(
      (notification) => {
        setNotifications((prev) => [notification, ...prev].slice(0, 30));
        setUnreadCount((prev) => prev + 1);
      },
      () => {
        // Keep existing state; manual reload still works.
      }
    );

    notificationStreamRef.current = source;
    return () => {
      if (source) {
        source.close();
      }
    };
  }, [currentUser]);

  useEffect(() => {
    if (feedStreamRef.current) {
      feedStreamRef.current.close();
      feedStreamRef.current = null;
    }

    const source = createFeedStream(
      (eventPayload) => {
        mergeIncomingPost(eventPayload?.post, eventPayload?.eventType || "post_updated");
      },
      () => {
        // Feed can still be refreshed manually.
      }
    );

    feedStreamRef.current = source;
    return () => {
      if (source) {
        source.close();
      }
    };
  }, [mergeIncomingPost]);

  async function onPublish() {
    const text = compose.trim();
    if (!text) {
      return;
    }

    const tags = (text.match(/#[a-zA-Z0-9_]+/g) || ["#update"]).slice(0, 4);
    const mediaUrls = composeMedia
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.startsWith("https://") || item.startsWith("http://"))
      .slice(0, 4);
    const pollOptions = [composePollA.trim(), composePollB.trim()].filter(Boolean);

    let parentPostId = null;
    if (composeParentPostId.trim()) {
      const parsedParentId = Number(composeParentPostId.trim());
      if (!Number.isFinite(parsedParentId) || parsedParentId <= 0) {
        setError("Thread parent id must be a positive number");
        return;
      }
      parentPostId = parsedParentId;
    }

    try {
      setError("");
      await createPost({
        content: text,
        tags,
        mediaUrls,
        pollOptions,
        parentPostId,
      });
      setCompose("");
      setComposeMedia("");
      setComposePollA("");
      setComposePollB("");
      setComposeParentPostId("");
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      }
      setPublishSuccess(true);
      scheduleTimeout(() => setPublishSuccess(false), 420);
      triggerToast("Post published");
      await Promise.all([loadSidebarData(), loadPostsPage(0, false)]);
    } catch (err) {
      setError(err.message || "Failed to publish");
    }
  }

  function onSaveMutedWords() {
    const words = mutedWordsInput
      .split(",")
      .map((word) => word.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 10);

    setMutedWords(words);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MUTE_WORDS_KEY, words.join(","));
    }
    triggerToast(words.length ? "Mute words saved" : "Mute words cleared");
  }

  async function onEngage(postId, action) {
    try {
      setError("");
      await engage(postId, action);
      triggerActionPulse(postId, action);
      triggerToast(`${action[0].toUpperCase()}${action.slice(1)} updated`);
      await Promise.all([loadSidebarData(), loadPostsPage(0, false)]);
    } catch (err) {
      setError(err.message || "Failed to update engagement");
    }
  }

  function onStartEdit(post) {
    setEditingPostId(post.id);
    setEditDraft(post.content || "");
  }

  function onCancelEdit() {
    setEditingPostId(null);
    setEditDraft("");
  }

  async function onSaveEdit(postId) {
    const text = editDraft.trim();
    if (!text) {
      return;
    }

    try {
      setError("");
      await editPost(postId, text);
      setEditingPostId(null);
      setEditDraft("");
      triggerToast("Post updated");
      await Promise.all([loadSidebarData(), loadPostsPage(0, false)]);
    } catch (err) {
      setError(err.message || "Failed to edit post");
    }
  }

  async function onVotePoll(postId, option) {
    try {
      setError("");
      await votePoll(postId, option);
      triggerToast("Vote submitted");
      await loadPostsPage(0, false);
    } catch (err) {
      setError(err.message || "Failed to vote in poll");
    }
  }

  async function onSubmitAuth() {
    try {
      setError("");
      const response = authMode === "login"
        ? await login({ email: authForm.email, password: authForm.password })
        : await register({
            email: authForm.email,
            password: authForm.password,
            handle: authForm.handle,
            displayName: authForm.displayName,
          });

      setCurrentUser(response.user);
      setShowPersonalized(false);
      triggerToast(authMode === "login" ? "Signed in" : "Account created");
      await Promise.all([loadSidebarData(), loadPostsPage(0, false)]);
    } catch (err) {
      setError(err.message || "Authentication failed");
    }
  }

  async function onFollowToggle(user) {
    try {
      setError("");
      if (user.followedByCurrentUser) {
        await unfollowUser(user.id);
        triggerToast("Unfollowed user");
      } else {
        await followUser(user.id);
        triggerToast("Following user");
      }
      triggerFollowPulse(user.id);
      await loadSidebarData();
      if (currentUser) {
        const meData = await me();
        setCurrentUser(meData);
      }
    } catch (err) {
      setError(err.message || "Failed to update follow state");
    }
  }

  async function loadComments(postId) {
    try {
      const data = await getComments(postId);
      setCommentsByPost((prev) => ({ ...prev, [postId]: data }));
    } catch (err) {
      setError(err.message || "Failed to load comments");
    }
  }

  async function submitComment(postId) {
    const text = (commentDraft[postId] || "").trim();
    if (!text) {
      return;
    }

    try {
      await addComment(postId, text);
      setCommentDraft((prev) => ({ ...prev, [postId]: "" }));
      triggerToast("Comment added");
      await Promise.all([loadComments(postId), loadPostsPage(0, false)]);
    } catch (err) {
      setError(err.message || "Failed to add comment");
    }
  }

  async function onSelectConversation(peerId) {
    setActiveMessagePeerId(peerId);
    await loadMessageThreadData(peerId);
  }

  async function onSendMessage() {
    if (!currentUser || !activeMessagePeerId) {
      return;
    }

    const text = messageDraft.trim();
    if (!text) {
      return;
    }

    try {
      setSendingMessage(true);
      setError("");
      await sendMessage(activeMessagePeerId, text);
      setMessageDraft("");
      triggerToast("Message sent");
      await loadMessageInboxData(activeMessagePeerId);
    } catch (err) {
      setError(err.message || "Failed to send message");
    } finally {
      setSendingMessage(false);
    }
  }

  async function onMarkNotificationRead(notificationId) {
    try {
      await markNotificationRead(notificationId);
      setNotifications((prev) => prev.map((item) => (
        item.id === notificationId ? { ...item, isRead: true } : item
      )));
      setUnreadCount((prev) => Math.max(0, prev - 1));
      triggerToast("Notification marked read");
    } catch (err) {
      setError(err.message || "Failed to mark notification");
    }
  }

  async function onLogout() {
    await logout();
    clearSession();
    setCurrentUser(null);
    setShowPersonalized(false);
    setSuggestedUsers([]);
    setNotifications([]);
    setUnreadCount(0);
    setError("");
    triggerToast("Signed out");
    await Promise.all([loadSidebarData(), loadPostsPage(0, false)]);
  }

  const feedTitle = useMemo(() => {
    if (activeView === "Bookmarks") {
      return "Your Bookmarked Posts";
    }
    if (activeView === "Explore") {
      return "Explore";
    }
    if (showPersonalized && currentUser) {
      return "Your Personalized Feed";
    }
    if (debouncedQuery.trim()) {
      return `Results for "${debouncedQuery.trim()}"`;
    }
    return "Live Feed";
  }, [activeView, debouncedQuery, showPersonalized, currentUser]);

  const visiblePosts = useMemo(() => {
    let nextPosts = activeView === "Bookmarks"
      ? posts.filter((post) => post.bookmarkCount > 0)
      : posts;

    if (mutedWords.length > 0) {
      nextPosts = nextPosts.filter((post) => {
        const text = `${post.author} ${post.handle} ${post.content} ${(post.tags || []).join(" ")}`.toLowerCase();
        return mutedWords.every((word) => !text.includes(word));
      });
    }

    return nextPosts;
  }, [activeView, posts, mutedWords]);

  const activeConversation = useMemo(() => (
    messageInbox.find((item) => item.peerId === activeMessagePeerId) || null
  ), [messageInbox, activeMessagePeerId]);

  const canCompose = activeView === "Home" || activeView === "Explore";
  const shouldShowRightCol = isFeedView && (!isMobileViewport || showMobileInsights);

  const focusComposer = useCallback(() => {
    setActiveView("Home");
    if (typeof window === "undefined") {
      return;
    }
    window.requestAnimationFrame(() => {
      document.getElementById("composer")?.focus();
    });
  }, []);

  return (
    <div className="page-bg">
      <div className="orb orb-a" aria-hidden="true" />
      <div className="orb orb-b" aria-hidden="true" />
      <div className="orb orb-c" aria-hidden="true" />

      <div className="app-shell">
        <aside className="glass left-rail">
          <div className="brand-wrap">
            <div className="brand-mark">P</div>
            <div>
              <h1>Pulse</h1>
              <p>Social Studio</p>
            </div>
          </div>

          <nav className="main-nav" aria-label="Main navigation">
            {navItems.map((item) => (
              <button
                type="button"
                key={item}
                className={`nav-btn ${activeView === item ? "active" : ""}`}
                onClick={() => setActiveView(item)}
              >
                <span>{item}</span>
                {item === "Notifications" && unreadCount > 0 ? (
                  <span className="notif-pill" aria-label={`${unreadCount} unread notifications`}>
                    {unreadCount}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>

          {currentUser ? (
            <section className="user-card">
              <h4>{currentUser.displayName}</h4>
              <p>{currentUser.handle}</p>
              <small>{currentUser.followers} followers · {currentUser.following} following</small>
              <button type="button" className="hero-btn" onClick={onLogout}>Logout</button>
            </section>
          ) : (
            <section className="auth-card">
              <div className="auth-switch">
                <button type="button" className={`nav-btn ${authMode === "login" ? "active" : ""}`} onClick={() => setAuthMode("login")}>Login</button>
                <button type="button" className={`nav-btn ${authMode === "register" ? "active" : ""}`} onClick={() => setAuthMode("register")}>Register</button>
              </div>
              {authMode === "register" ? (
                <input
                  placeholder="Display name"
                  value={authForm.displayName}
                  onChange={(event) => setAuthForm((prev) => ({ ...prev, displayName: event.target.value }))}
                />
              ) : null}
              {authMode === "register" ? (
                <input
                  placeholder="Handle (e.g. @sam)"
                  value={authForm.handle}
                  onChange={(event) => setAuthForm((prev) => ({ ...prev, handle: event.target.value }))}
                />
              ) : null}
              <input
                placeholder="Email"
                value={authForm.email}
                onChange={(event) => setAuthForm((prev) => ({ ...prev, email: event.target.value }))}
              />
              <input
                placeholder="Password"
                type="password"
                value={authForm.password}
                onChange={(event) => setAuthForm((prev) => ({ ...prev, password: event.target.value }))}
              />
              <button type="button" className="hero-btn" onClick={onSubmitAuth}>
                {authMode === "login" ? "Sign In" : "Create Account"}
              </button>
            </section>
          )}

          <button type="button" className="hero-btn" onClick={focusComposer}>
            Quick Post
          </button>

          <section className="auth-card mute-card">
            <h4>Muted Words</h4>
            <input
              placeholder="comma,separated,words"
              value={mutedWordsInput}
              onChange={(event) => setMutedWordsInput(event.target.value)}
            />
            <button type="button" className="nav-btn" onClick={onSaveMutedWords}>
              Save Filters
            </button>
          </section>
        </aside>

        <main className="center-col">
          <header className="glass panel-header">
            <div className="panel-title-wrap">
              <h2>{activeView}</h2>
              {isFeedView ? (
                <span className={`live-indicator ${feedLivePulse ? "pulse" : ""}`}>
                  Live Feed
                </span>
              ) : null}
            </div>
            <div className="header-controls">
              {isMobileViewport && isFeedView ? (
                <button
                  type="button"
                  className={`nav-btn ${showMobileInsights ? "active" : ""}`}
                  onClick={() => setShowMobileInsights((prev) => !prev)}
                >
                  {showMobileInsights ? "Hide Insights" : "Show Insights"}
                </button>
              ) : null}
              {currentUser && isFeedView ? (
                <button
                  type="button"
                  className={`nav-btn ${showPersonalized ? "active" : ""}`}
                  onClick={() => setShowPersonalized((prev) => !prev)}
                >
                  {showPersonalized ? "Viewing Personalized" : "Switch to Personalized"}
                </button>
              ) : null}
              {isFeedView ? (
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  type="text"
                  placeholder="Search posts, tags, or creators"
                />
              ) : null}
            </div>
          </header>

          <div key={`${activeView}-${viewMotionKey}`} className="view-stage">
          {canCompose ? (
            <section className="glass composer">
              <label htmlFor="composer">What is happening now?</label>
              <textarea
                id="composer"
                maxLength={280}
                rows={4}
                value={compose}
                onChange={(event) => setCompose(event.target.value)}
                placeholder="Share an update with tags like #product or #frontend"
              />
              <div className="composer-grid">
                <input
                  placeholder="Media URLs (comma separated)"
                  value={composeMedia}
                  onChange={(event) => setComposeMedia(event.target.value)}
                />
                <input
                  placeholder="Thread parent id (optional)"
                  value={composeParentPostId}
                  onChange={(event) => setComposeParentPostId(event.target.value)}
                />
                <input
                  placeholder="Poll option A"
                  value={composePollA}
                  onChange={(event) => setComposePollA(event.target.value)}
                />
                <input
                  placeholder="Poll option B"
                  value={composePollB}
                  onChange={(event) => setComposePollB(event.target.value)}
                />
              </div>
              <div className="composer-foot">
                <span className={charLeft < 30 ? "warning" : ""}>{charLeft} characters left</span>
                <button
                  type="button"
                  className={`hero-btn ${publishSuccess ? "btn-success" : ""}`}
                  onClick={onPublish}
                >
                  Publish
                </button>
              </div>
            </section>
          ) : null}

          {isFeedView ? (
            <section className="feed-block">
            <div className="feed-head">
              <h3>{feedTitle}</h3>
              <p>{activeView === "Bookmarks" ? visiblePosts.length : feedTotal} posts</p>
            </div>

            {loading && visiblePosts.length === 0 ? (
              <div className="feed-grid skeleton-grid" aria-hidden="true">
                {Array.from({ length: SKELETON_COUNT }).map((_, index) => (
                  <article key={`skeleton-${index}`} className="glass post-card skeleton-card">
                    <div className="skeleton-row">
                      <div className="skeleton-avatar" />
                      <div className="skeleton-stack">
                        <span className="skeleton-line medium" />
                        <span className="skeleton-line short" />
                      </div>
                    </div>
                    <span className="skeleton-line full" />
                    <span className="skeleton-line full" />
                    <span className="skeleton-line medium" />
                  </article>
                ))}
              </div>
            ) : null}
            {error ? <p className="glass notice error">{error}</p> : null}

            <div className="feed-grid">
              {visiblePosts.map((post, index) => (
                <article
                  key={post.id}
                  data-post-id={post.id}
                  className={`glass post-card ${reduceMotion || revealedPosts[post.id] ? "reveal-in" : "reveal-init"}`}
                  style={{ "--stagger-order": index }}
                >
                  <div className="post-top">
                    <div className="avatar" />
                    <div className="post-head-copy">
                      <h4>{post.author}</h4>
                      <p>{post.handle}</p>
                    </div>
                    <div className="post-top-meta">
                      {post.editedAt ? <small className="edited-badge">Edited</small> : null}
                      {post.parentPostId ? <small className="thread-badge">Thread #{post.parentPostId}</small> : null}
                    </div>
                  </div>

                  {editingPostId === post.id ? (
                    <div className="edit-box">
                      <textarea
                        rows={3}
                        maxLength={280}
                        value={editDraft}
                        onChange={(event) => setEditDraft(event.target.value)}
                      />
                      <div className="edit-actions">
                        <button type="button" className="hero-btn" onClick={() => onSaveEdit(post.id)}>
                          Save Edit
                        </button>
                        <button type="button" className="nav-btn" onClick={onCancelEdit}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="content">{post.content}</p>
                  )}

                  {Array.isArray(post.mediaUrls) && post.mediaUrls.length > 0 ? (
                    <div className="media-strip">
                      {post.mediaUrls.map((url) => (
                        looksLikeImage(url) ? (
                          <img key={`${post.id}-${url}`} src={url} alt="Post media" loading="lazy" />
                        ) : (
                          <a key={`${post.id}-${url}`} href={url} target="_blank" rel="noreferrer">
                            Open media
                          </a>
                        )
                      ))}
                    </div>
                  ) : null}

                  {post.poll ? (
                    <div className="poll-box">
                      {post.poll.options.map((option) => (
                        <button
                          key={`${post.id}-${option.label}`}
                          type="button"
                          className="poll-option"
                          disabled={post.poll.hasVoted || !currentUser}
                          onClick={() => onVotePoll(post.id, option.label)}
                        >
                          <span>{option.label}</span>
                          <strong>{option.percentage}%</strong>
                        </button>
                      ))}
                      <small>
                        {post.poll.totalVotes} votes
                        {post.poll.hasVoted ? " • You voted" : ""}
                      </small>
                    </div>
                  ) : null}

                  <div className="tags">
                    {(post.tags || []).map((tag) => (
                      <span key={`${post.id}-${tag}`}>{tag}</span>
                    ))}
                  </div>

                  <div className="actions">
                    <button
                      type="button"
                      className={buttonPulse[`${post.id}-reply`] ? "action-pop" : ""}
                      onClick={() => onEngage(post.id, "reply")}
                    >
                      Reply {post.replyCount}
                    </button>
                    <button
                      type="button"
                      className={buttonPulse[`${post.id}-repost`] ? "action-pop" : ""}
                      onClick={() => onEngage(post.id, "repost")}
                    >
                      Repost {post.repostCount}
                    </button>
                    <button
                      type="button"
                      className={buttonPulse[`${post.id}-like`] ? "action-pop" : ""}
                      onClick={() => onEngage(post.id, "like")}
                    >
                      Like {post.likeCount}
                    </button>
                    <button
                      type="button"
                      className={buttonPulse[`${post.id}-bookmark`] ? "action-pop" : ""}
                      onClick={() => onEngage(post.id, "bookmark")}
                    >
                      Save {post.bookmarkCount}
                    </button>
                    {currentUser && currentUser.handle === post.handle ? (
                      <button type="button" onClick={() => onStartEdit(post)}>
                        Edit
                      </button>
                    ) : null}
                  </div>

                  <div className="insights-row">
                    <small>{post.viewCount ?? post.insights?.views ?? 0} views</small>
                    <small>{Number(post.insights?.engagementRate || 0).toFixed(1)}% engagement</small>
                  </div>

                  <div className="comment-section">
                    <button type="button" className="nav-btn" onClick={() => loadComments(post.id)}>
                      Load Comments ({post.commentCount ?? 0})
                    </button>
                    <div className="comment-list">
                      {(commentsByPost[post.id] || []).map((item) => (
                        <div key={item.id} className="comment-item">
                          <strong>{item.author}</strong>
                          <p>{item.content}</p>
                        </div>
                      ))}
                    </div>
                    {currentUser ? (
                      <div className="comment-compose">
                        <input
                          placeholder="Write a comment"
                          value={commentDraft[post.id] || ""}
                          onChange={(event) =>
                            setCommentDraft((prev) => ({ ...prev, [post.id]: event.target.value }))
                          }
                        />
                        <button type="button" className="hero-btn" onClick={() => submitComment(post.id)}>
                          Comment
                        </button>
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>

            {activeView === "Bookmarks" && !loading && visiblePosts.length === 0 ? (
              <p className="glass notice">No bookmarks yet. Save posts to see them here.</p>
            ) : null}

            {loadingMore ? <p className="glass notice">Loading more posts...</p> : null}
            <div ref={loadMoreRef} style={{ height: 2 }} aria-hidden="true" />
            </section>
          ) : null}

          {activeView === "Notifications" ? (
            <section className="glass card">
              <h3>All Notifications</h3>
              {notifications.length === 0 ? <p className="notice">You are all caught up.</p> : null}
              <ul className="gaps-list">
                {notifications.map((item) => (
                  <li key={item.id}>
                    <h4>{item.type}{item.isRead ? "" : " • new"}</h4>
                    <p>{item.message}</p>
                    {!item.isRead ? (
                      <button type="button" className="nav-btn" onClick={() => onMarkNotificationRead(item.id)}>
                        Mark read
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {activeView === "Messages" ? (
            <section className="glass card messages-shell">
              <h3>Messages</h3>
              {!currentUser ? (
                <p className="notice">Sign in to use your inbox and direct messages.</p>
              ) : (
                <div className="messages-grid">
                  <aside className="messages-inbox">
                    <div className="messages-inbox-head">
                      <strong>Inbox</strong>
                      <small>{messageInbox.length} conversations</small>
                    </div>
                    {loadingMessages ? <p className="notice">Loading conversations...</p> : null}
                    {!loadingMessages && messageInbox.length === 0 ? (
                      <p className="notice">No conversations yet. Follow someone and send your first message.</p>
                    ) : null}

                    <ul className="messages-list">
                      {messageInbox.map((conversation) => (
                        <li key={conversation.peerId}>
                          <button
                            type="button"
                            className={`message-peer-btn ${activeMessagePeerId === conversation.peerId ? "active" : ""}`}
                            onClick={() => onSelectConversation(conversation.peerId)}
                          >
                            <span className="peer-line">
                              <strong>{conversation.peerDisplayName}</strong>
                              <small>{conversation.peerHandle}</small>
                            </span>
                            <p>{conversation.lastMessage}</p>
                            <span className="peer-meta">
                              <small>
                                {conversation.lastMessageAt
                                  ? new Date(conversation.lastMessageAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                                  : ""}
                              </small>
                              {conversation.unreadCount > 0 ? (
                                <span className="notif-pill">{conversation.unreadCount}</span>
                              ) : null}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </aside>

                  <section className="messages-thread">
                    {activeConversation ? (
                      <>
                        <header className="messages-thread-head">
                          <h4>{activeConversation.peerDisplayName}</h4>
                          <small>{activeConversation.peerHandle}</small>
                        </header>

                        <div className="messages-bubbles">
                          {messageThread.map((message) => (
                            <article
                              key={message.id}
                              className={`message-bubble ${message.mine ? "mine" : "theirs"}`}
                            >
                              <p>{message.content}</p>
                              <small>
                                {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </small>
                            </article>
                          ))}
                          {messageThread.length === 0 ? (
                            <p className="notice">No messages yet. Send the first one.</p>
                          ) : null}
                        </div>

                        <div className="messages-compose">
                          <input
                            placeholder={`Message ${activeConversation.peerDisplayName}`}
                            value={messageDraft}
                            onChange={(event) => setMessageDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                onSendMessage();
                              }
                            }}
                          />
                          <button type="button" className="hero-btn" onClick={onSendMessage} disabled={sendingMessage}>
                            {sendingMessage ? "Sending..." : "Send"}
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="notice">Select a conversation from your inbox to start messaging.</p>
                    )}
                  </section>
                </div>
              )}
            </section>
          ) : null}

          {activeView === "Lists" ? (
            <section className="glass card">
              <h3>Lists</h3>
              <p className="notice">Create and manage topic lists here. List APIs are not connected yet.</p>
            </section>
          ) : null}

          {activeView === "Dashboard" ? (
            <section className="glass card">
              <h3>Dashboard</h3>
              <div className="stats-grid">
                <article>
                  <p>Total Posts</p>
                  <strong>{dashboard?.totalPosts ?? 0}</strong>
                </article>
                <article>
                  <p>Total Engagement</p>
                  <strong>{dashboard?.totalEngagement ?? 0}</strong>
                </article>
                <article>
                  <p>Avg Likes</p>
                  <strong>{dashboard?.averageLikes ?? 0}</strong>
                </article>
                <article>
                  <p>Saved Posts</p>
                  <strong>{dashboard?.savedPosts ?? 0}</strong>
                </article>
              </div>

              <h3>Trending Tags</h3>
              <ul className="trend-list">
                {(dashboard?.trends ?? []).map((trend) => (
                  <li key={trend.tag}>
                    <span>{trend.tag}</span>
                    <strong>{trend.score}</strong>
                  </li>
                ))}
              </ul>

              <h3>Weekly Activity</h3>
              <div className="bars">
                {(dashboard?.weeklyActivity ?? []).map((value, index) => (
                  <div key={`${value}-${index}`} className="bar-wrap">
                    <div className="bar" style={{ height: `${value}%`, "--bar-order": index }} />
                    <small>{["M", "T", "W", "T", "F", "S", "S"][index]}</small>
                  </div>
                ))}
              </div>

              <h3>Missing Functionalities Analysis</h3>
              <ul className="gaps-list">
                {(dashboard?.missingFunctionalities ?? []).map((item) => (
                  <li key={item.area}>
                    <h4>{item.area}</h4>
                    <p>{item.whyItMatters}</p>
                    <small>{item.suggestedImplementation}</small>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          </div>
        </main>

        {shouldShowRightCol ? (
          <aside key={`right-${activeView}-${viewMotionKey}`} className={`right-col view-stage side-stage ${isMobileViewport ? "mobile-insights" : ""}`}>
          <section className="glass card">
            <h3>Dashboard Snapshot</h3>
            <div className="stats-grid">
              <article>
                <p>Total Posts</p>
                <strong>{dashboard?.totalPosts ?? 0}</strong>
              </article>
              <article>
                <p>Total Engagement</p>
                <strong>{dashboard?.totalEngagement ?? 0}</strong>
              </article>
              <article>
                <p>Avg Likes</p>
                <strong>{dashboard?.averageLikes ?? 0}</strong>
              </article>
              <article>
                <p>Saved Posts</p>
                <strong>{dashboard?.savedPosts ?? 0}</strong>
              </article>
            </div>
          </section>

          <section className="glass card">
            <h3>Trending Tags</h3>
            <ul className="trend-list">
              {(dashboard?.trends ?? []).map((trend) => (
                <li key={trend.tag}>
                  <span>{trend.tag}</span>
                  <strong>{trend.score}</strong>
                </li>
              ))}
            </ul>
          </section>

          <section className="glass card">
            <h3>Weekly Activity</h3>
            <div className="bars">
              {(dashboard?.weeklyActivity ?? []).map((value, index) => (
                <div key={`${value}-${index}`} className="bar-wrap">
                  <div className="bar" style={{ height: `${value}%`, "--bar-order": index }} />
                  <small>{["M", "T", "W", "T", "F", "S", "S"][index]}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="glass card">
            <h3>Missing Functionalities Analysis</h3>
            <ul className="gaps-list">
              {(dashboard?.missingFunctionalities ?? []).map((item) => (
                <li key={item.area}>
                  <h4>{item.area}</h4>
                  <p>{item.whyItMatters}</p>
                  <small>{item.suggestedImplementation}</small>
                </li>
              ))}
            </ul>
          </section>

          {currentUser ? (
            <section className="glass card">
              <h3>Suggested Users</h3>
              <ul className="gaps-list">
                {suggestedUsers.map((user) => (
                  <li key={user.id}>
                    <h4>{user.displayName}</h4>
                    <p>{user.handle}</p>
                    <button
                      type="button"
                      className={`hero-btn ${followPulse[String(user.id)] ? "follow-pop" : ""}`}
                      onClick={() => onFollowToggle(user)}
                    >
                      {user.followedByCurrentUser ? "Unfollow" : "Follow"}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {currentUser ? (
            <section className="glass card">
              <h3>Notifications ({unreadCount} unread)</h3>
              <ul className="gaps-list">
                {notifications.map((item) => (
                  <li key={item.id}>
                    <h4>{item.type}{item.isRead ? "" : " • new"}</h4>
                    <p>{item.message}</p>
                    {!item.isRead ? (
                      <button type="button" className="nav-btn" onClick={() => onMarkNotificationRead(item.id)}>
                        Mark read
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          </aside>
        ) : null}

        <div className={`app-toast ${toastMessage ? "show" : ""}`} role="status" aria-live="polite">
          {toastMessage}
        </div>
      </div>

      {isMobileViewport ? (
        <nav className="mobile-tabbar glass" aria-label="Mobile quick navigation">
          {mobileNavItems.map((item) => (
            <button
              type="button"
              key={item.view}
              className={`mobile-tab ${activeView === item.view ? "active" : ""}`}
              onClick={() => {
                setActiveView(item.view);
                setShowMobileInsights(false);
              }}
            >
              <span>{item.label}</span>
              {item.view === "Notifications" && unreadCount > 0 ? (
                <span className="mobile-badge" aria-label={`${unreadCount} unread notifications`}>
                  {unreadCount}
                </span>
              ) : null}
            </button>
          ))}
          <button type="button" className="mobile-compose-btn" onClick={focusComposer}>
            Post
          </button>
        </nav>
      ) : null}
    </div>
  );
}

export default App;
