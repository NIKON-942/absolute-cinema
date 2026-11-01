// DTO shapes from docs/api-contract.md — single source of truth for the frontend.

export type Role = 'viewer' | 'admin';
export type SubscriptionTier = 'basic' | 'plus' | 'premium';
export type SubscriptionPeriod = 'monthly' | 'yearly';
export type SubscriptionStatus = 'pending' | 'active' | 'expired' | 'cancelled';
export type Quality = '480p' | '720p' | '1080p';
export type MovieSort = 'popularity' | 'rating' | 'newest';
export type TranscodeStatus = 'none' | 'processing' | 'ready' | 'failed';

export interface UserDto {
  id: number;
  email: string;
  name: string;
  role: Role;
  isBlocked: boolean;
  avatarUrl: string | null;
  hasActiveSubscription: boolean;
  activeSubscription: SubscriptionDto | null;
  createdAt: string; // ISO
  lastLoginAt: string | null;
}

export interface GenreDto {
  id: number;
  name: string;
}

export interface ActorDto {
  id: number;
  name: string;
  photoUrl?: string;
}

export interface SubscriptionDto {
  id: number;
  tier: SubscriptionTier;
  period: SubscriptionPeriod;
  status: SubscriptionStatus;
  startsAt: string | null;
  endsAt: string | null;
}

export interface MovieDto {
  id: number;
  title: string;
  originalTitle: string;
  description: string;
  year: number;
  country: string;
  ageRating: string;
  director: string;
  runtimeMinutes: number | null;
  trailerUrl: string | null;
  keywords: string[];
  posterUrl: string;
  masterVideoUrl: string | null;
  transcodeStatus: TranscodeStatus;
  genres: GenreDto[];
  actors: ActorDto[];
  viewCount: number;
  averageRating: number; // 0..10, one decimal
  userRating: number | null; // 1..10 when the authenticated user rated
  isFavorite: boolean;
  availableQualities: Quality[];
  createdAt: string;
}

export interface CountryDto {
  id: number;
  name: string;
}

export interface DirectorDto {
  id: number;
  name: string;
}

export interface TranscodeJobDto {
  movieId: number;
  status: TranscodeStatus;
  qualities: string[];
  progress: number | null;
  phase: 'queued' | 'probing' | 'audio' | 'converting' | 'finalizing' | 'ready' | 'failed' | 'unavailable' | 'none';
  currentQuality: Quality | null;
  targetQualities: Quality[];
  renditions?: Array<{ quality: Quality; progress: number | null; state: 'queued' | 'converting' | 'finalizing' | 'ready' | 'failed'; mode: 'copy' | 'encode' }>;
  startedAt?: string | null;
  finishedAt?: string | null;
  elapsedSeconds?: number;
  remainingSeconds?: number | null;
  error?: string;
}

export interface WatchProgressDto {
  movieId: number;
  movieTitle: string;
  year: number;
  genres: { id: number; name: string }[];
  posterUrl: string;
  positionSeconds: number;
  durationSeconds: number;
  updatedAt: string;
}

export interface PlanDto {
  tier: SubscriptionTier;
  monthlyPrice: number;
  yearlyPrice: number;
  currency: 'usd';
  /** Concurrent streaming devices enforced by the backend. */
  maxDevices: number;
  /** Highest quality the tier is allowed to request. */
  maxQuality: Quality;
  prioritySupport: boolean;
  features: string[];
}

/** One registered streaming device of the current user (GET /devices). */
export interface DeviceSessionDto {
  deviceId: string;
  name: string | null;
  lastSeenAt: string;
  createdAt: string;
}

export interface DevicesDto {
  devices: DeviceSessionDto[];
  maxDevices: number;
}

export interface HeartbeatResultDto {
  activeDevices: number;
  maxDevices: number;
}

/** Paginated envelope used by GET /media and GET /users. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface AnalyticsDto {
  totalUsers: number;
  totalMovies: number;
  activeSubscriptions: number;
  intervalDays: number;
  newUsersInPeriod: number;
  topMovies: TopMovieDto[];
  genrePopularity: GenrePopularityDto[];
  revenueByMonth: RevenueByMonthDto[];
}

export interface GenrePopularityDto {
  genre: string;
  views: number;
  movies: number;
  averageRating: number;
}

export interface TopMovieDto {
  id: number;
  title: string;
  viewCount: number;
  averageRating: number;
}

export interface RevenueByMonthDto {
  month: string; // e.g. "2026-08"
  total: number;
}

export interface RatingResultDto {
  averageRating: number;
  userRating: number | null;
}

export interface FavoriteResultDto {
  isFavorite: boolean;
}

export interface AuthResponseDto {
  user: UserDto;
  accessToken: string;
}

export interface MessageDto {
  message: string;
}

export interface CheckoutResponseDto {
  checkoutUrl: string;
}

export interface MovieFilters {
  search?: string;
  genre?: string;
  year?: number | '';
  yearFrom?: number | '';
  yearTo?: number | '';
  country?: string;
  ageRating?: string;
  sort?: MovieSort;
  page?: number;
  limit?: number;
}
