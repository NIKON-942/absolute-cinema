import { Navigate, useLocation, useParams } from 'react-router-dom';

export default function Watch() {
  const { id } = useParams<{ id: string }>();
  const { search, hash } = useLocation();
  return <Navigate to={`/movie/${id}${search}${hash}`} replace />;
}
