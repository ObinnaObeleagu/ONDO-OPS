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

export interface WardCoverage {
  ward_id: number;
  ward_name: string;
  ward_code: string;
  lga_id: number;
  lga_name: string;
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

export interface PuCurrent {
  pu_id: number;
  inec_code: string;
  pu_name: string;
  registered_voters: number;
  ward_id: number;
  ward_name: string;
  lga_id: number;
  lga_name: string;
  submission_id: string | null;
  total_valid_votes: number | null;
  rejected_votes: number | null;
  accredited_voters: number | null;
  verification_state: string | null;
  has_ec8a: boolean | null;
  remarks: string | null;
  submitted_at: string | null;
  channel: string | null;
  agent_name: string | null;
  agent_phone: string | null;
  agent_phones: string[] | null;
  status: 'not_reported' | 'pending' | 'verified' | 'disputed';
  turnout_pct: number | null;
}

export interface OutstandingPu {
  pu_id: number;
  inec_code: string;
  pu_name: string;
  registered_voters: number;
  ward_id: number;
  ward_name: string;
  lga_id: number;
  lga_name: string;
  agent_name: string | null;
  agent_phone: string | null;
  agent_phones: string[] | null;
  whatsapp_phone: string | null;
  contactable: boolean;
}

export interface PartyTotalByLga {
  lga_id: number;
  lga_name: string;
  party_code: string;
  party_name: string;
  colour: string | null;
  votes: number;
}

export interface AgentWithPhones {
  id: string;
  pu_id: number;
  full_name: string;
  agent_phones: {
    phone: string;
    label: string | null;
    is_primary: boolean;
    whatsapp_enabled: boolean;
    consent_recorded_at: string | null;
    is_active: boolean;
  }[];
}

export interface Party {
  code: string;
  name: string;
  is_tracked: boolean;
  sort_order: number;
}
