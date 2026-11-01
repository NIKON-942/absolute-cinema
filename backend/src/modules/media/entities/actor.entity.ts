import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('actors')
export class ActorEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  name: string;

  @Column({ type: 'varchar', nullable: true })
  photoUrl: string | null;
}
