import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addComment,
  clearSession,
  createNotificationStream,
  createPost,
  engage,
  followUser,
  getComments,
  getDashboard,
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
  setSession,
  unfollowUser,
} from "./api";

const PAGE_SIZE = 10;
const SKELETON_COUNT = 3;

const navItems = [
  "Home",
  "Explore",
  "Notifications",
  "Messages",
  "Bookmarks",
  "Lists",
  "Dashboard",
];

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
  const [error, setError] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [showPersonalized, setShowPersonalized] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
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
  const [viewMotionKey, setViewMotionKey] = useState(0);
  const [revealedPosts, setRevealedPosts] = useState({});
  const [buttonPulse, setButtonPulse] = useState({});
  const [followPulse, setFollowPulse] = useState({});
  const [publishSuccess, setPublishSuccess] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  const loadMoreRef = useRef(null);
  const streamRef = useRef(null);
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

  useEffect(() => () => {
    timersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    timersRef.current = [];
  }, []);

  useEffect(() => {
    setViewMotionKey((prev) => prev + 1);
  }, [activeView]);

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
    const dashboardData = await getDashboard();
    setDashboard(dashboardData);

    if (!getToken()) {
      setNotifications([]);
      setUnreadCount(0);
      setSuggestedUsers([]);
      return;
    }

    const [notifData, usersData, unreadData] = await Promise.all([
      getNotifications(),
      getSuggestedUsers(),
      getUnreadNotificationCount(),
    ]);

    setNotifications(notifData);
    setSuggestedUsers(usersData);
    setUnreadCount(unreadData?.count ?? 0);
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

  const bootstrap = useCallback(async () => {
    try {
      setError("");
      if (getToken()) {
        try {
          const meData = await me();
          setCurrentUser(meData);
        } catch {
          clearSession();
          setCurrentUser(null);
        }
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
      if (streamRef.current) {
        streamRef.current.close();
        streamRef.current = null;
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

    streamRef.current = source;
    return () => {
      if (source) {
        source.close();
      }
    };
  }, [currentUser]);

  async function onPublish() {
    const text = compose.trim();
    if (!text) {
      return;
    }

    const tags = (text.match(/#[a-zA-Z0-9_]+/g) || ["#update"]).slice(0, 4);

    try {
      setError("");
      await createPost({ content: text, tags });
      setCompose("");
      setPublishSuccess(true);
      scheduleTimeout(() => setPublishSuccess(false), 420);
      triggerToast("Post published");
      await Promise.all([loadSidebarData(), loadPostsPage(0, false)]);
    } catch (err) {
      setError(err.message || "Failed to publish");
    }
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

      setSession(response.token, response.refreshToken);
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
    if (activeView === "Bookmarks") {
      return posts.filter((post) => post.bookmarkCount > 0);
    }
    return posts;
  }, [activeView, posts]);

  const canCompose = activeView === "Home" || activeView === "Explore";

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

          <button type="button" className="hero-btn" onClick={() => document.getElementById("composer")?.focus()}>
            Quick Post
          </button>
        </aside>

        <main className="center-col">
          <header className="glass panel-header">
            <h2>{activeView}</h2>
            <div className="header-controls">
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
                    <div>
                      <h4>{post.author}</h4>
                      <p>{post.handle}</p>
                    </div>
                  </div>

                  <p className="content">{post.content}</p>

                  <div className="tags">
                    {post.tags.map((tag) => (
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
            <section className="glass card">
              <h3>Messages</h3>
              <p className="notice">Dedicated messaging inbox will be connected in a backend step.</p>
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

        {activeView === "Home" || activeView === "Explore" || activeView === "Bookmarks" ? (
          <aside key={`right-${activeView}-${viewMotionKey}`} className="right-col view-stage side-stage">
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
    </div>
  );
}

export default App;
