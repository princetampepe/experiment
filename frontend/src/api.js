import {
  addCommentInFirestore,
  createFeedStreamFromFirestore,
  createNotificationStreamFromFirestore,
  createPostInFirestore,
  editPostInFirestore,
  engageInFirestore,
  followUserInFirestore,
  getCommentsFromFirestore,
  getDashboardFromFirestore,
  getMessageInboxFromFirestore,
  getMessageThreadFromFirestore,
  getNotificationsFromFirestore,
  getPersonalizedFeedFromFirestore,
  getPostInsightsFromFirestore,
  getPostsFromFirestore,
  getSuggestedUsersFromFirestore,
  getUnreadNotificationCountFromFirestore,
  markMessageThreadReadInFirestore,
  markNotificationReadInFirestore,
  sendMessageInFirestore,
  syncAuthUserToFirestore,
  unfollowUserInFirestore,
  votePollInFirestore,
} from "./firestoreDb";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import { firebaseAuth } from "./firebase";

const BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8080/api").replace(/\/$/, "");
const STORAGE_KEY = "pulse_offline_posts_v1";
const TOKEN_KEY = "pulse_token_v1";
const REFRESH_TOKEN_KEY = "pulse_refresh_token_v1";
const OFFLINE_ENGAGEMENT_KEY = "pulse_offline_engagement_v1";

const fallbackGaps = [
  {
    area: "Authentication",
    whyItMatters: "Without identity, actions cannot be trusted or personalized.",
    suggestedImplementation: "Add JWT auth with refresh tokens and protected routes.",
  },
  {
    area: "Follow Graph",
    whyItMatters: "A social feed needs follower relationships for relevance.",
    suggestedImplementation: "Model users, follows, and timeline ranking queries.",
  },
  {
    area: "Notifications",
    whyItMatters: "Users need updates for mentions, replies, and reposts.",
    suggestedImplementation: "Create notifications plus websocket delivery.",
  },
  {
    area: "Media Uploads",
    whyItMatters: "Text-only content limits creator workflows and engagement.",
    suggestedImplementation: "Add local file uploads and media metadata records.",
  },
  {
    area: "Moderation",
    whyItMatters: "Platforms need reporting and abuse handling to stay safe.",
    suggestedImplementation: "Implement report queues and moderation status flow.",
  },
];

function buildHandleCandidate(input, fallback = "user") {
  const cleaned = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 20);
  const fallbackClean = String(fallback || "user")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 20);
  return `@${cleaned || fallbackClean || "user"}`;
}

function mapFirebaseUserProfile(authUser, profileOverrides = {}) {
  const uid = String(authUser?.uid || "").trim();
  const email = String(profileOverrides.email || authUser?.email || "").trim();
  const displayName = String(profileOverrides.displayName || authUser?.displayName || "").trim();
  const handle = buildHandleCandidate(
    profileOverrides.handle || displayName || email || uid,
    uid || "user"
  );

  return {
    id: uid,
    authUid: uid,
    email,
    handle,
    displayName: displayName || handle.replace(/^@/, "") || "Pulse User",
    bio: String(profileOverrides.bio || "").trim() || "Building in public on Pulse.",
  };
}

function normalizeFirebaseAuthError(error, fallbackMessage) {
  const code = String(error?.code || "");

  if (code === "auth/email-already-in-use") {
    return "Email is already registered";
  }
  if (code === "auth/invalid-credential") {
    return "Invalid email or password";
  }
  if (code === "auth/user-disabled") {
    return "This account is disabled";
  }
  if (code === "auth/too-many-requests") {
    return "Too many attempts. Please try again in a moment";
  }
  if (code === "auth/network-request-failed") {
    return "Network error while contacting Firebase Auth";
  }

  return error?.message || fallbackMessage;
}

async function waitForFirebaseAuthUser() {
  if (firebaseAuth.currentUser) {
    return firebaseAuth.currentUser;
  }

  if (typeof window === "undefined") {
    return firebaseAuth.currentUser;
  }

  return new Promise((resolve) => {
    let resolved = false;
    let unsubscribe = () => {};

    const finish = (user) => {
      if (resolved) {
        return;
      }
      resolved = true;
      window.clearTimeout(timeoutId);
      unsubscribe();
      resolve(user || null);
    };

    const timeoutId = window.setTimeout(() => {
      finish(firebaseAuth.currentUser);
    }, 1400);

    unsubscribe = onAuthStateChanged(
      firebaseAuth,
      (user) => {
        finish(user);
      },
      () => {
        finish(firebaseAuth.currentUser);
      }
    );
  });
}

async function buildFirebaseSessionResponse(authUser, profileOverrides = {}, forceRefresh = false) {
  const token = await authUser.getIdToken(forceRefresh);
  const refreshToken = authUser.refreshToken || "";
  const profileSeed = mapFirebaseUserProfile(authUser, profileOverrides);
  const syncedProfile = await syncAuthUserToFirestore(profileSeed).catch(() => profileSeed);

  return {
    token,
    refreshToken,
    user: syncedProfile || profileSeed,
  };
}

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return null;
  }
  return response.json();
}

async function request(path, options = {}, canRetry = true) {
  const token = getToken();
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  if ((response.status === 401 || response.status === 403) && canRetry && shouldRefresh(path)) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return request(path, options, false);
    }
  }

  if (!response.ok) {
    let message = "Request failed";
    try {
      const payload = await parseResponse(response);
      message = payload?.error || message;
    } catch {
      const text = await response.text();
      message = text || message;
    }
    throw new Error(message);
  }

  return parseResponse(response);
}

function shouldRefresh(path) {
  return !path.startsWith("/auth/login")
    && !path.startsWith("/auth/register")
    && !path.startsWith("/auth/refresh");
}

async function refreshSession() {
  const authUser = firebaseAuth.currentUser;
  if (authUser) {
    try {
      const token = await authUser.getIdToken(true);
      const refreshToken = authUser.refreshToken || getRefreshToken();
      setSession(token, refreshToken || "");
      return true;
    } catch {
      // Fall through to legacy backend refresh token flow.
    }
  }

  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    clearSession();
    return false;
  }

  const response = await fetch(`${BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });

  if (!response.ok) {
    clearSession();
    return false;
  }

  const payload = await parseResponse(response);
  if (!payload?.token || !payload?.refreshToken) {
    clearSession();
    return false;
  }

  setSession(payload.token, payload.refreshToken);
  return true;
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY) || "";
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function setSession(token, refreshToken) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

function getSeedPosts() {
  return [
    {
      id: 1001,
      author: "Avery Stone",
      handle: "@averystone",
      content:
        "Rolling out our instant feedback loop. The team shipped from idea to prototype in 48 hours.",
      tags: ["#buildinpublic", "#product"],
      mediaUrls: ["https://images.unsplash.com/photo-1551434678-e076c223a692?q=80&w=1280&auto=format&fit=crop"],
      poll: null,
      parentPostId: null,
      replyCount: 4,
      repostCount: 9,
      likeCount: 27,
      bookmarkCount: 6,
      createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      editedAt: null,
      viewCount: 126,
      commentCount: 0,
      insights: { views: 126, engagementTotal: 46, engagementRate: 36.51 },
    },
    {
      id: 1002,
      author: "Maya Lin",
      handle: "@mayaops",
      content:
        "Small dashboards beat giant reports. If you cannot decide in 30 seconds, it needs less noise.",
      tags: ["#analytics", "#ux"],
      mediaUrls: [],
      poll: {
        options: [
          { label: "Keep single KPI", votes: 11, percentage: 39.3 },
          { label: "Show multi-metric", votes: 17, percentage: 60.7 },
        ],
        totalVotes: 28,
        hasVoted: false,
      },
      parentPostId: null,
      replyCount: 7,
      repostCount: 15,
      likeCount: 39,
      bookmarkCount: 11,
      createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      editedAt: null,
      viewCount: 208,
      commentCount: 0,
      insights: { views: 208, engagementTotal: 72, engagementRate: 34.62 },
    },
    {
      id: 1003,
      author: "Noah Park",
      handle: "@noahcreates",
      content:
        "Just tested a calmer notification design. Attention is a design material, not free inventory.",
      tags: ["#design", "#frontend"],
      mediaUrls: ["https://images.unsplash.com/photo-1517048676732-d65bc937f952?q=80&w=1280&auto=format&fit=crop"],
      poll: null,
      parentPostId: 1001,
      replyCount: 2,
      repostCount: 5,
      likeCount: 20,
      bookmarkCount: 4,
      createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      editedAt: null,
      viewCount: 154,
      commentCount: 0,
      insights: { views: 154, engagementTotal: 31, engagementRate: 20.13 },
    },
  ].map(ensureOfflinePostShape);
}

function calculateOfflineInsights(post) {
  const views = Number(post.viewCount || 0);
  const engagementTotal = Number(post.likeCount || 0)
    + Number(post.repostCount || 0)
    + Number(post.replyCount || 0)
    + Number(post.bookmarkCount || 0)
    + Number(post.commentCount || 0);
  const engagementRate = views === 0
    ? (engagementTotal === 0 ? 0 : 100)
    : Number(((engagementTotal * 100) / views).toFixed(2));

  return {
    views,
    engagementTotal,
    engagementRate,
  };
}

function ensureOfflinePostShape(post) {
  const shaped = {
    ...post,
    tags: Array.isArray(post.tags) && post.tags.length ? post.tags : ["#update"],
    mediaUrls: Array.isArray(post.mediaUrls) ? post.mediaUrls : [],
    poll: post.poll && Array.isArray(post.poll.options)
      ? {
          options: post.poll.options.map((option) => ({
            label: option.label,
            votes: Number(option.votes || 0),
            percentage: Number(option.percentage || 0),
          })),
          totalVotes: Number(post.poll.totalVotes || 0),
          hasVoted: Boolean(post.poll.hasVoted),
        }
      : null,
    parentPostId: post.parentPostId ?? null,
    editedAt: post.editedAt ?? null,
    commentCount: Number(post.commentCount || 0),
    viewCount: Number(post.viewCount || 0),
  };

  return {
    ...shaped,
    insights: post.insights || calculateOfflineInsights(shaped),
  };
}

function buildOfflinePoll(pollOptions = []) {
  const cleanedOptions = pollOptions
    .map((option) => String(option || "").trim())
    .filter(Boolean)
    .slice(0, 4);

  if (cleanedOptions.length < 2) {
    return null;
  }

  return {
    options: cleanedOptions.map((label) => ({
      label,
      votes: 0,
      percentage: 0,
    })),
    totalVotes: 0,
    hasVoted: false,
  };
}

function readOfflinePosts() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seed = getSeedPosts();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    return seed;
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(ensureOfflinePostShape) : getSeedPosts();
  } catch {
    const seed = getSeedPosts();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    return seed;
  }
}

function writeOfflinePosts(posts) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(posts));
}

function readOfflineEngagement() {
  const raw = localStorage.getItem(OFFLINE_ENGAGEMENT_KEY);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeOfflineEngagement(state) {
  localStorage.setItem(OFFLINE_ENGAGEMENT_KEY, JSON.stringify(state));
}

function getOfflineActorKey() {
  const token = getToken();
  if (!token) {
    return "guest";
  }

  try {
    const [, payload] = token.split(".");
    if (!payload) {
      return `token:${token.slice(-12)}`;
    }

    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    const actorId = decoded?.sub || decoded?.uid || decoded?.user_id;
    if (actorId) {
      return `user:${actorId}`;
    }
    return `token:${token.slice(-12)}`;
  } catch {
    return `token:${token.slice(-12)}`;
  }
}

function filterPosts(posts, query) {
  const q = query.trim().toLowerCase();
  if (!q) {
    return posts;
  }

  return posts.filter((post) => {
    const tags = Array.isArray(post.tags) ? post.tags.join(" ") : "";
    const text = `${post.author} ${post.handle} ${post.content} ${tags}`.toLowerCase();
    return text.includes(q);
  });
}

function buildDashboardFromPosts(posts) {
  const totalPosts = posts.length;
  const totalLikes = posts.reduce((sum, post) => sum + post.likeCount, 0);
  const totalReposts = posts.reduce((sum, post) => sum + post.repostCount, 0);
  const totalReplies = posts.reduce((sum, post) => sum + post.replyCount, 0);
  const savedPosts = posts.reduce((sum, post) => sum + post.bookmarkCount, 0);
  const totalEngagement = totalLikes + totalReposts + totalReplies + savedPosts;
  const averageLikes = totalPosts === 0 ? 0 : Math.round(totalLikes / totalPosts);

  const trendMap = new Map();
  posts.forEach((post) => {
    const score = post.likeCount + post.repostCount + post.bookmarkCount;
    post.tags.forEach((tag) => {
      trendMap.set(tag, (trendMap.get(tag) || 0) + score);
    });
  });

  const trends = [...trendMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([tag, score]) => ({ tag, score }));

  const weeklyActivity = [45, 52, 38, 60, 66, 58, Math.min(100, 49 + totalPosts * 2)];

  return {
    totalPosts,
    totalEngagement,
    averageLikes,
    savedPosts,
    trends,
    weeklyActivity,
    missingFunctionalities: fallbackGaps,
  };
}

function buildFeedPath(basePath, { query = "", page = 0, size = 10 } = {}) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("size", String(size));
  if (query.trim()) {
    params.set("query", query.trim());
  }
  return `${basePath}?${params.toString()}`;
}

export function getPosts(params = {}) {
  return getPostsFromFirestore(params).catch(() => (
    request(buildFeedPath("/posts", params)).catch(() => {
      const { query = "", page = 0, size = 10 } = params;
      const posts = filterPosts(readOfflinePosts(), query).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      const start = page * size;
      const items = posts.slice(start, start + size);
      return {
        items,
        page,
        size,
        totalElements: posts.length,
        hasNext: start + size < posts.length,
      };
    })
  ));
}

export function getPersonalizedFeed(params = {}) {
  return getPersonalizedFeedFromFirestore(params).catch(() => request(buildFeedPath("/feed/personalized", params)));
}

export function createPost(payload) {
  return createPostInFirestore(payload).catch(() => (
    request("/posts", {
      method: "POST",
      body: JSON.stringify({
        content: payload.content,
        tags: payload.tags,
        mediaUrls: payload.mediaUrls,
        pollOptions: payload.pollOptions,
        parentPostId: payload.parentPostId,
      }),
    }).catch(() => {
      const posts = readOfflinePosts();
      const id = Date.now();
      const mediaUrls = Array.isArray(payload.mediaUrls) ? payload.mediaUrls.slice(0, 4) : [];
      const poll = buildOfflinePoll(Array.isArray(payload.pollOptions) ? payload.pollOptions : []);
      const next = {
        id,
        author: payload.author || "You",
        handle: payload.handle || "@you",
        content: payload.content || "",
        tags: Array.isArray(payload.tags) && payload.tags.length ? payload.tags : ["#update"],
        mediaUrls,
        poll,
        parentPostId: payload.parentPostId ?? null,
        replyCount: 0,
        repostCount: 0,
        likeCount: 0,
        bookmarkCount: 0,
        commentCount: 0,
        createdAt: new Date().toISOString(),
        editedAt: null,
        viewCount: 0,
      };
      const merged = [ensureOfflinePostShape(next), ...posts];
      writeOfflinePosts(merged);
      return merged[0];
    })
  ));
}

export function editPost(postId, content) {
  return editPostInFirestore(postId, content).catch(() => (
    request(`/posts/${postId}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }).catch(() => {
      const posts = readOfflinePosts();
      const updated = posts.map((post) => {
        if (post.id !== postId) {
          return post;
        }

        const editedPost = ensureOfflinePostShape({
          ...post,
          content,
          editedAt: new Date().toISOString(),
        });
        return {
          ...editedPost,
          insights: calculateOfflineInsights(editedPost),
        };
      });

      writeOfflinePosts(updated);
      return updated.find((post) => post.id === postId);
    })
  ));
}

export function votePoll(postId, option) {
  return votePollInFirestore(postId, option).catch(() => (
    request(`/posts/${postId}/poll/vote`, {
      method: "POST",
      body: JSON.stringify({ option }),
    }).catch(() => {
      const posts = readOfflinePosts();
      const updated = posts.map((post) => {
        if (post.id !== postId || !post.poll) {
          return post;
        }

        const totalVotes = Number(post.poll.totalVotes || 0) + 1;
        const options = post.poll.options.map((pollOption) => {
          const votes = pollOption.label === option ? Number(pollOption.votes || 0) + 1 : Number(pollOption.votes || 0);
          return {
            ...pollOption,
            votes,
            percentage: totalVotes === 0 ? 0 : Number(((votes * 100) / totalVotes).toFixed(1)),
          };
        });

        const nextPost = ensureOfflinePostShape({
          ...post,
          poll: {
            options,
            totalVotes,
            hasVoted: true,
          },
        });

        return {
          ...nextPost,
          insights: calculateOfflineInsights(nextPost),
        };
      });

      writeOfflinePosts(updated);
      return updated.find((post) => post.id === postId);
    })
  ));
}

export function getPostInsights(postId) {
  return getPostInsightsFromFirestore(postId).catch(() => (
    request(`/posts/${postId}/insights`).catch(() => {
      const post = readOfflinePosts().find((item) => item.id === postId);
      if (!post) {
        return { views: 0, engagementTotal: 0, engagementRate: 0 };
      }
      return calculateOfflineInsights(post);
    })
  ));
}

export function engage(postId, action) {
  return engageInFirestore(postId, action).catch(() => (
    request(`/posts/${postId}/engage`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }).catch(() => {
      const posts = readOfflinePosts();
      const offlineEngagement = readOfflineEngagement();
      const actorKey = getOfflineActorKey();
      const postKey = String(postId);
      const actorState = offlineEngagement[actorKey] || {};
      const postState = actorState[postKey] || { like: false, repost: false };
      let nextPostState = postState;

      const updated = posts.map((post) => {
        if (post.id !== postId) {
          return post;
        }

        let changedPost = post;

        if (action === "reply") {
          changedPost = { ...post, replyCount: post.replyCount + 1 };
        }
        if (action === "repost") {
          if (postState.repost) {
            return post;
          }
          nextPostState = { ...nextPostState, repost: true };
          changedPost = { ...post, repostCount: post.repostCount + 1 };
        }
        if (action === "like") {
          if (postState.like) {
            return post;
          }
          nextPostState = { ...nextPostState, like: true };
          changedPost = { ...post, likeCount: post.likeCount + 1 };
        }
        if (action === "bookmark") {
          changedPost = { ...post, bookmarkCount: post.bookmarkCount + 1 };
        }

        const shaped = ensureOfflinePostShape(changedPost);
        return {
          ...shaped,
          insights: calculateOfflineInsights(shaped),
        };
      });

      writeOfflinePosts(updated);
      if (action === "like" || action === "repost") {
        writeOfflineEngagement({
          ...offlineEngagement,
          [actorKey]: {
            ...actorState,
            [postKey]: nextPostState,
          },
        });
      }
      return updated.find((post) => post.id === postId);
    })
  ));
}

export function getDashboard() {
  return getDashboardFromFirestore().catch(() => (
    request("/dashboard").catch(() => {
      const posts = readOfflinePosts();
      return buildDashboardFromPosts(posts);
    })
  ));
}

export async function register(payload) {
  try {
    const credential = await createUserWithEmailAndPassword(
      firebaseAuth,
      String(payload?.email || "").trim(),
      String(payload?.password || "")
    );

    const requestedDisplayName = String(payload?.displayName || "").trim();
    if (requestedDisplayName) {
      await updateProfile(credential.user, { displayName: requestedDisplayName }).catch(() => {
        // Profile update can fail in strict browser contexts; auth still succeeds.
      });
    }

    const response = await buildFirebaseSessionResponse(
      credential.user,
      {
        email: payload?.email,
        handle: payload?.handle,
        displayName: requestedDisplayName,
      },
      true
    );

    setSession(response.token, response.refreshToken);
    return response;
  } catch (error) {
    throw new Error(normalizeFirebaseAuthError(error, "Registration failed"));
  }
}

export async function login(payload) {
  try {
    const credential = await signInWithEmailAndPassword(
      firebaseAuth,
      String(payload?.email || "").trim(),
      String(payload?.password || "")
    );

    const response = await buildFirebaseSessionResponse(credential.user, {}, true);
    setSession(response.token, response.refreshToken);
    return response;
  } catch (error) {
    throw new Error(normalizeFirebaseAuthError(error, "Login failed"));
  }
}

export async function me() {
  const authUser = await waitForFirebaseAuthUser();
  if (!authUser) {
    clearSession();
    throw new Error("Authentication required");
  }

  const response = await buildFirebaseSessionResponse(authUser, {}, true);
  setSession(response.token, response.refreshToken);
  return response.user;
}

export function logout() {
  return signOut(firebaseAuth)
    .then(() => null)
    .catch(() => null);
}

export function getSuggestedUsers() {
  return getSuggestedUsersFromFirestore().catch(() => request("/users/suggested"));
}

export function followUser(userId) {
  return followUserInFirestore(userId).catch(() => (
    request(`/users/${userId}/follow`, {
      method: "POST",
    })
  ));
}

export function unfollowUser(userId) {
  return unfollowUserInFirestore(userId).catch(() => (
    request(`/users/${userId}/follow`, {
      method: "DELETE",
    })
  ));
}

export function getNotifications() {
  return getNotificationsFromFirestore().catch(() => request("/notifications"));
}

export function getMessageInbox() {
  return getMessageInboxFromFirestore().catch(() => request("/messages/inbox").catch(() => []));
}

export function getMessageThread(peerId) {
  return getMessageThreadFromFirestore(peerId).catch(() => request(`/messages/thread/${peerId}`).catch(() => []));
}

export function sendMessage(recipientId, content) {
  return sendMessageInFirestore(recipientId, content).catch(() => (
    request("/messages", {
      method: "POST",
      body: JSON.stringify({ recipientId, content }),
    })
  ));
}

export function markMessageThreadRead(peerId) {
  return markMessageThreadReadInFirestore(peerId).catch(() => (
    request(`/messages/thread/${peerId}/read`, {
      method: "PATCH",
    }).catch(() => ({ status: "ok" }))
  ));
}

export function getUnreadNotificationCount() {
  return getUnreadNotificationCountFromFirestore().catch(() => request("/notifications/unread-count"));
}

export function markNotificationRead(notificationId) {
  return markNotificationReadInFirestore(notificationId).catch(() => (
    request(`/notifications/${notificationId}/read`, {
      method: "PATCH",
    })
  ));
}

export function createNotificationStream(onNotification, onError) {
  try {
    const firestoreStream = createNotificationStreamFromFirestore(onNotification, onError);
    if (firestoreStream) {
      return firestoreStream;
    }
  } catch {
    // Fall through to backend SSE stream.
  }

  const token = getToken();
  if (!token) {
    return null;
  }

  const streamUrl = `${BASE_URL}/notifications/stream?token=${encodeURIComponent(token)}`;
  const source = new EventSource(streamUrl);

  source.addEventListener("notification", (event) => {
    try {
      const payload = JSON.parse(event.data);
      onNotification(payload);
    } catch {
      // Ignore malformed events.
    }
  });

  source.onerror = () => {
    if (onError) {
      onError();
    }
  };

  return source;
}

export function createFeedStream(onFeedEvent, onError) {
  try {
    const firestoreStream = createFeedStreamFromFirestore(onFeedEvent, onError);
    if (firestoreStream) {
      return firestoreStream;
    }
  } catch {
    // Fall through to backend SSE stream.
  }

  const token = getToken();
  const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : "";
  const source = new EventSource(`${BASE_URL}/feed/stream${tokenQuery}`);

  source.addEventListener("feed", (event) => {
    try {
      const payload = JSON.parse(event.data);
      onFeedEvent(payload);
    } catch {
      // Ignore malformed events.
    }
  });

  source.onerror = () => {
    if (onError) {
      onError();
    }
  };

  return source;
}

export function getComments(postId) {
  return getCommentsFromFirestore(postId).catch(() => request(`/posts/${postId}/comments`));
}

export function addComment(postId, content) {
  return addCommentInFirestore(postId, content).catch(() => (
    request(`/posts/${postId}/comments`, {
      method: "POST",
      body: JSON.stringify({ content }),
    })
  ));
}
