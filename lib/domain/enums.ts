/**
 * Controlled vocabularies for the Sweater Man Content OS.
 * Kept in one place so the DB, the zod schemas, the UI and the AI tool
 * definitions can never drift apart.
 */

export const CONTENT_TYPES = [
  'DISCOVERY',
  'AUDIENCE',
  'PROCESS',
  'AUTHORITY',
  'COMMERCIAL',
  'CORE',
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_TYPE_LABEL: Record<ContentType, string> = {
  DISCOVERY: 'Discovery',
  AUDIENCE: 'Audience',
  PROCESS: 'Process',
  AUTHORITY: 'Authority',
  COMMERCIAL: 'Commercial',
  CORE: 'Core',
};

/** The weekly rhythm slots from the operating template (a starting point, not a law). */
export const SLOT_TYPES = [
  'topic_hypothesis',
  'process_backstage',
  'core_video',
  'audience_extension',
  'authority_commercial',
  'core_video_2',
  'custom',
] as const;
export type SlotType = (typeof SLOT_TYPES)[number];

export const PLATFORMS = ['instagram', 'tiktok', 'youtube', 'telegram'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABEL: Record<Platform, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  telegram: 'Telegram',
};

/** surface = where on the platform; format = the shape of the artefact. */
export const PLATFORM_SURFACES = {
  instagram: ['reel', 'story', 'carousel', 'post'],
  tiktok: ['video', 'photo_mode', 'story'],
  youtube: ['shorts', 'community_post', 'community_poll', 'community_quiz'],
  telegram: ['bot_broadcast', 'bot_interaction', 'lead_magnet', 'creator_content', 'commercial_cta'],
} as const satisfies Record<Platform, readonly string[]>;

export type Surface = (typeof PLATFORM_SURFACES)[Platform][number];

export const UNIT_STATUSES = [
  'idea',
  'drafted',
  'ready',
  'scheduled',
  'published',
  'skipped',
] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

export const PUBLISH_STATUSES = ['not_published', 'published', 'skipped'] as const;
export type PublishStatus = (typeof PUBLISH_STATUSES)[number];

/**
 * Effort is expressed as a rough working-time bucket, because the team's real
 * constraint is "how long does this supporting unit take", not story points.
 */
export const EFFORTS = ['XS', 'S', 'M', 'L'] as const;
export type Effort = (typeof EFFORTS)[number];

export const EFFORT_LABEL: Record<Effort, string> = {
  XS: '≤10 min',
  S: '~30 min',
  M: '1–2 h',
  L: 'half day+',
};

export const CORE_VIDEO_STAGES = [
  'idea',
  'research',
  'storyboard',
  'shooting',
  'assets',
  'assembly',
  'capcut',
  'ready',
  'published',
] as const;
export type CoreVideoStage = (typeof CORE_VIDEO_STAGES)[number];

export const BACKLOG_STATUSES = [
  'RAW',
  'TEST',
  'PROMISING',
  'RESEARCH',
  'CORE_CANDIDATE',
  'PRODUCED',
  'REJECTED',
] as const;
export type BacklogStatus = (typeof BACKLOG_STATUSES)[number];

export const ANALYTICS_WINDOWS = ['24h', '72h', '7d', '30d'] as const;
export type AnalyticsWindow = (typeof ANALYTICS_WINDOWS)[number];

/** Hours after publishing at which each report becomes due. */
export const ANALYTICS_WINDOW_HOURS: Record<AnalyticsWindow, number> = {
  '24h': 24,
  '72h': 72,
  '7d': 24 * 7,
  '30d': 24 * 30,
};

/** Windows that V1 actively tracks on the card. 30d is supported but optional. */
export const REQUIRED_ANALYTICS_WINDOWS: AnalyticsWindow[] = ['24h', '72h', '7d'];

export const CONFIDENCE_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export const LEARNING_CATEGORIES = [
  'content',
  'production',
  'funnel',
  'platform',
  'operations',
  'audience',
] as const;
export type LearningCategory = (typeof LEARNING_CATEGORIES)[number];

export const REVIEW_RESULTS = ['YES', 'NO', 'TOO_EARLY'] as const;
export type ReviewResult = (typeof REVIEW_RESULTS)[number];

export const ROLES = ['OWNER', 'EDITOR', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

export const STRATEGY_CHANGE_STATUSES = ['PROPOSED', 'APPROVED', 'REJECTED'] as const;
export type StrategyChangeStatus = (typeof STRATEGY_CHANGE_STATUSES)[number];

/** Metric keys the vision extractor is allowed to emit. Anything else is dropped. */
export const METRIC_KEYS = [
  'views',
  'likes',
  'comments',
  'shares',
  'saves',
  'reposts',
  'reach',
  'watch_time_hours',
  'average_watch_time_sec',
  'completion_rate_pct',
  'followers_gained',
  'profile_visits',
  'link_clicks',
  'poll_votes',
  'replies',
  'telegram_starts',
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export const METRIC_LABEL: Record<MetricKey, string> = {
  views: 'Views',
  likes: 'Likes',
  comments: 'Comments',
  shares: 'Shares',
  saves: 'Saves',
  reposts: 'Reposts',
  reach: 'Reach / accounts',
  watch_time_hours: 'Watch time (h)',
  average_watch_time_sec: 'Avg watch time (s)',
  completion_rate_pct: 'Completion %',
  followers_gained: 'Followers gained',
  profile_visits: 'Profile visits',
  link_clicks: 'Link clicks',
  poll_votes: 'Poll votes',
  replies: 'Replies',
  telegram_starts: 'Telegram starts',
};
