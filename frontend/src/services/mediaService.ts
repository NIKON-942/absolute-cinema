import { api } from './api';
import type {
  ActorDto,
  CountryDto,
  DirectorDto,
  FavoriteResultDto,
  GenreDto,
  MessageDto,
  MovieDto,
  MovieFilters,
  Paginated,
  RatingResultDto,
  TranscodeJobDto,
  WatchProgressDto,
} from '@/types';

export interface MovieUpsertPayload {
  title?: string;
  originalTitle?: string;
  description?: string;
  year?: number;
  country?: string;
  ageRating?: string;
  director?: string;
  runtimeMinutes?: number | '';
  trailerUrl?: string;
  keywords?: string; // comma-separated
  genreIds?: number[];
  actorIds?: number[];
  posterUrl?: string;    // direct URL alternative to poster upload
  masterVideoUrl?: string; // master video URL alternative to upload (transcoded server-side)
  file?: File | null;    // poster image
}

export interface VideoUploadProgress {
  loaded: number;
  total: number | null;
  rate: number | null;
}

function toForm(payload: MovieUpsertPayload): FormData {
  const form = new FormData();
  if (payload.file) form.append('file', payload.file);
  const entries: Array<[string, unknown]> = [
    ['title', payload.title],
    ['originalTitle', payload.originalTitle],
    ['description', payload.description],
    ['year', payload.year],
    ['country', payload.country],
    ['ageRating', payload.ageRating],
    ['director', payload.director],
    ['runtimeMinutes', payload.runtimeMinutes],
    ['trailerUrl', payload.trailerUrl],
    ['keywords', payload.keywords],
    ['posterUrl', payload.posterUrl],
    ['masterVideoUrl', payload.masterVideoUrl],
  ];
  for (const [key, value] of entries) {
    if (value !== undefined && value !== null && (value !== '' || key === 'posterUrl')) form.append(key, String(value));
  }
  if (payload.genreIds) form.append('genreIds', JSON.stringify(payload.genreIds));
  if (payload.actorIds) form.append('actorIds', JSON.stringify(payload.actorIds));
  return form;
}

export const mediaService = {
  list(filters: MovieFilters): Promise<Paginated<MovieDto>> {
    return api.get('/media', { params: filters }).then((r) => r.data);
  },

  getById(id: number): Promise<MovieDto> {
    return api.get(`/media/${id}`).then((r) => r.data);
  },

  similar(id: number): Promise<MovieDto[]> {
    return api.get(`/media/${id}/similar`).then((r) => r.data);
  },

  genres(): Promise<GenreDto[]> {
    return api.get('/media/genres').then((r) => r.data);
  },

  actors(): Promise<ActorDto[]> {
    return api.get('/media/actors').then((r) => r.data);
  },

  countries(): Promise<CountryDto[]> {
    return api.get('/media/countries').then((r) => r.data);
  },

  directors(): Promise<DirectorDto[]> {
    return api.get('/media/directors').then((r) => r.data);
  },

  createCountry(name: string): Promise<CountryDto> {
    return api.post('/media/countries', { name }).then((r) => r.data);
  },

  updateCountry(id: number, name: string): Promise<CountryDto> {
    return api.patch(`/media/countries/${id}`, { name }).then((r) => r.data);
  },

  deleteCountry(id: number): Promise<void> {
    return api.delete(`/media/countries/${id}`).then(() => undefined);
  },

  createDirector(name: string): Promise<DirectorDto> {
    return api.post('/media/directors', { name }).then((r) => r.data);
  },

  updateDirector(id: number, name: string): Promise<DirectorDto> {
    return api.patch(`/media/directors/${id}`, { name }).then((r) => r.data);
  },

  deleteDirector(id: number): Promise<void> {
    return api.delete(`/media/directors/${id}`).then(() => undefined);
  },

  createGenre(name: string): Promise<GenreDto> {
    return api.post('/media/genres', { name }).then((r) => r.data);
  },

  updateGenre(id: number, name: string): Promise<GenreDto> {
    return api.patch(`/media/genres/${id}`, { name }).then((r) => r.data);
  },

  deleteGenre(id: number): Promise<void> {
    return api.delete(`/media/genres/${id}`).then(() => undefined);
  },

  createActor(name: string, photoUrl?: string, file?: File | null): Promise<ActorDto> {
    if (file) {
      const form = new FormData(); form.append('name', name); form.append('file', file);
      return api.post('/media/actors', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
    }
    return api.post('/media/actors', { name, photoUrl }).then((r) => r.data);
  },

  updateActor(id: number, name: string, photoUrl?: string, file?: File | null): Promise<ActorDto> {
    if (file) {
      const form = new FormData(); form.append('name', name); form.append('file', file);
      return api.patch(`/media/actors/${id}`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
    }
    return api.patch(`/media/actors/${id}`, { name, photoUrl }).then((r) => r.data);
  },

  deleteActor(id: number): Promise<void> {
    return api.delete(`/media/actors/${id}`).then(() => undefined);
  },

  /** Toggle favorite. Returns the new state. */
  toggleFavorite(id: number): Promise<FavoriteResultDto> {
    return api.post(`/media/${id}/favorites`).then((r) => r.data);
  },

  favorites(): Promise<MovieDto[]> {
    return api.get('/media/favorites').then((r) => r.data);
  },

  rate(id: number, value: number): Promise<RatingResultDto> {
    return api.put(`/media/${id}/rating`, { value }).then((r) => r.data);
  },

  removeRating(id: number): Promise<RatingResultDto> {
    return api.delete(`/media/${id}/rating`).then((r) => r.data);
  },

  saveProgress(id: number, positionSeconds: number, durationSeconds: number): Promise<MessageDto> {
    return api
      .put(`/media/${id}/progress`, { positionSeconds, durationSeconds })
      .then((r) => r.data);
  },

  progress(): Promise<WatchProgressDto[]> {
    return api.get('/media/progress').then((r) => r.data);
  },

  recommendations(): Promise<MovieDto[]> {
    return api.get('/recommendations').then((r) => r.data);
  },

  // ---- Admin CRUD ----
  createMovie(payload: MovieUpsertPayload): Promise<MovieDto> {
    return api
      .post('/media', toForm(payload), { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((r) => r.data);
  },

  updateMovie(id: number, payload: MovieUpsertPayload): Promise<MovieDto> {
    return api
      .patch(`/media/${id}`, toForm(payload), { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((r) => r.data);
  },

  deleteMovie(id: number): Promise<void> {
    return api.delete(`/media/${id}`).then(() => undefined);
  },

  /**
   * Master video upload: the server stores it in storage/masters and runs
   * background transcoding into 480p/720p/1080p.
   */
  uploadMasterVideo(id: number, file: File, onProgress?: (percent: number | null, details: VideoUploadProgress) => void, signal?: AbortSignal): Promise<MovieDto> {
    const form = new FormData();
    form.append('file', file);
    return api
      .post(`/media/${id}/master-video`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        signal,
        onUploadProgress: ({ loaded, total, rate }) => onProgress?.(
          total ? Math.min(100, Math.floor(loaded / total * 100)) : null,
          { loaded, total: total ?? null, rate: rate && Number.isFinite(rate) ? rate : null },
        ),
      })
      .then((r) => r.data);
  },

  /** Live background transcode state (for polling). */
  transcodeStatus(id: number): Promise<TranscodeJobDto> {
    return api.get(`/media/${id}/transcode`).then((r) => r.data);
  },
};
