import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** FR-38: standardized country dictionary. */
@Entity('countries')
export class CountryEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  name: string;
}
