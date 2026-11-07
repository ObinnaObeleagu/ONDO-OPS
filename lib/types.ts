/**
 * Row shapes for the reporting views in db/03_views.sql. Kept here so
 * every portal page (control, lga, ward, agent) queries against the
 * same contract instead of re-guessing column names.
 */

export interface DistrictSummary {
  total_pus: number;
  reported_pus: number;
  outstanding_pus: number;
  reported_pct: number;
  verified_pus: number;
  disputed_pus: number;
  pending_pus: number;
  registered_voters: number;
  valid_votes: number;
  rejected_votes: number;
  turnout_pct_of_reported: number | null;
}

export interface PartyTotal {
  party_id: number;
  party_code: string;
  party_name: string;
  colour: string | null;
  votes: number;
  pus_counted: number;
}

export interface LgaCoverage {
  lga_id: number;
  lga_name: string;
  lga_code: string;
  total_wards: number;
  total_pus: number;
  reported_pus: number;
  outstanding_pus: number;
  reported_pct: number;
  verified_pus: number;
  disputed_pus: number;
  registered_voters: number;
  valid_votes: number;
  rejected_votes: number;
  last_report_at: string | null;
}

export interface OpenAlert {
  id: number;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  detail: string;
  created_at: string;
  pu_id: number;
  pu_name: string;
  inec_code: string;
  ward_name: string;
  lga_name: string;
  agent_name: string | null;
  agent_phone: string | null;
  agent_phones: string[] | null;
}

export interface IncidentRemark {
  submission_id: string;
  submitted_at: string;
  remarks: string;
  channel: string;
  pu_id: number;
  pu_name: string;
  inec_code: string;
  ward_name: string;
  lga_name: string;
  agent_name: string | null;
  agent_phone: string | null;
  verification_state: string;
}
