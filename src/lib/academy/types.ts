/* Tipos de la Academia WLP (contenido-como-codigo).
   El contenido vive en courses.ts (versionado); la BD solo guarda
   datos dinamicos: acceso, solicitudes, progreso y certificados. */

export type BlockType =
  | 'p'
  | 'h'
  | 'list'
  | 'ol'
  | 'table'
  | 'callout'
  | 'rule'
  | 'script';

/** Un bloque de contenido dentro de una leccion. Union laxa: cada tipo usa
    solo algunas props. Se valida en el renderer, no en el tipo. */
export interface Block {
  type: BlockType;
  /** p/h/callout/rule/script: string. list/ol: string[] (cada item). */
  v?: string | string[];
  /** encabezados de tabla */
  head?: string[];
  /** filas de tabla */
  rows?: string[][];
  /** estilo del callout (tip, warn, info...) */
  style?: string;
  /** icono del callout (nombre lucide) */
  ci?: string;
  /** etiqueta de la regla (rule) */
  lab?: string;
}

export interface Lesson {
  /** titulo de la leccion */
  t: string;
  blocks: Block[];
}

export interface QuizQuestion {
  q: string;
  opts: string[];
  /** indice de la opcion correcta */
  a: number;
  /** explicacion */
  ex?: string;
}

export interface Module {
  id: string;
  num: string;
  icon: string;
  dur: string;
  title: string;
  tag: string;
  objectives?: string[];
  lessons: Lesson[];
  quiz: QuizQuestion[];
}

export type CourseLang = 'es' | 'en';

export interface Course {
  id: string;
  status: 'live' | 'draft' | 'soon';
  lang: CourseLang;
  icon: string;
  accent: string;
  track: string;
  title: string;
  subtitle: string;
  certName: string;
  modules: Module[];
}

export interface ProfileDef {
  label: string;
  /** lista de course ids, o "*" para acceso total */
  courses: string[] | '*';
}

export type ProfileMap = Record<string, ProfileDef>;

/* ---- Filas de BD (espejo de las tablas academy_*) ---- */

export type AccessRequestStatus = 'pending' | 'approved' | 'rejected';

export interface AcademyAccess {
  id: string;
  profile_id: string;
  course_id: string;
  granted_by: string | null;
  granted_at: string;
}

export interface AcademyAccessRequest {
  id: string;
  profile_id: string;
  course_id: string;
  status: AccessRequestStatus;
  note: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface AcademyProgress {
  id: string;
  profile_id: string;
  course_id: string;
  module_id: string;
  /** puntaje del quiz 0..100 */
  score: number;
  completed: boolean;
  updated_at: string;
}

export interface AcademyCertificate {
  id: string;
  profile_id: string;
  course_id: string;
  /** codigo imprimible unico WLP-XXX-score-year */
  code: string;
  score: number;
  issued_at: string;
}
