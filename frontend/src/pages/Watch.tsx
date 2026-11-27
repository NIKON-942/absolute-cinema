import { Navigate, useLocation, useParams } from 'react-router-dom';

// old /watch/:id link, redirects to the movie page
export default function Watch() {
  const { id } = useParams<{ id: string }>();
  const { search, hash } = useLocation();
  return <Navigate to={`/movie/${id}${search}${hash}`} replace />;
}
