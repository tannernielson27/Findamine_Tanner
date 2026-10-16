import type {
  UserRole,
  UserStatus,
  HuntStatus,
  PlayMode,
  TargetAudience,
  SubjectDomain,
  ChallengeType,
  TeamStatus,
  TeamMemberRole,
} from "./enums";

// ── Users ──────────────────────────────────────────────

export interface User {
  id: string;
  auth_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  role: UserRole;
  status: UserStatus;
  date_of_birth: string | null;
  school_id: string | null;
  parent_id: string | null;
  metadata: Record<string, unknown>;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Hunts ──────────────────────────────────────────────

export interface Hunt {
  id: string;
  title: string;
  description: string | null;
  target_audience: TargetAudience;
  play_mode: PlayMode;
  status: HuntStatus;
  /** Listed in the public catalogue; only true once review_status is "approved" (migration 073). */
  is_public: boolean;
  is_template: boolean;
  review_status: "not_submitted" | "pending" | "approved" | "rejected";
  review_reason: string | null;
  review_submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  safety_affirmed_at: string | null;
  safety_affirmed_by: string | null;
  center_latitude: number | null;
  center_longitude: number | null;
  search_radius_km: number | null;
  estimated_duration_min: number | null;
  grade_range_min: number | null;
  grade_range_max: number | null;
  subject_domains: SubjectDomain[];
  created_by: string;
  source_template_id: string | null;
  metadata: Record<string, unknown>;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Locations ──────────────────────────────────────────

export interface Location {
  id: string;
  name: string;
  description: string | null;
  latitude: number;
  longitude: number;
  radius_meters: number;
  address: string | null;
  place_id: string | null;
  location_type: string | null;
  metadata: Record<string, unknown>;
  created_by: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Tasks ──────────────────────────────────────────────

export interface Task {
  id: string;
  title: string;
  subject_domain: SubjectDomain | null;
  challenge_type: ChallengeType;
  content: Record<string, unknown>;
  grade_range_min: number | null;
  grade_range_max: number | null;
  difficulty_level: number | null;
  feedback: Record<string, unknown>;
  created_by: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Teams ──────────────────────────────────────────────

export interface Team {
  id: string;
  hunt_id: string;
  name: string;
  status: TeamStatus;
  max_size: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  role: TeamMemberRole;
  joined_at: string;
}

// ── Auth helper return type ────────────────────────────

export interface AuthUser {
  id: string;
  auth_id: string;
  role: UserRole;
  display_name: string | null;
}
