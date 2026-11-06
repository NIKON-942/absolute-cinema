import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** FR-39: directors registry, relationally linked to movies via movie.directorId. */
@Entity('directors')
export class DirectorEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  name: string;
}
