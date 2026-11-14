// Frozen snapshot node IDs and source group sizes, before task-level row filtering.
export const groupLabels: Record<
  string,
  { first: string; last: string; rows: number; oracle?: string }
> = {
  webscraper_tables: { first: "1-74", last: "1-92", rows: 3, oracle: "g2" },
  mdn_status: { first: "0-1128", last: "0-1548", rows: 63, oracle: "g4" },
  python_docs_versions: { first: "1-371", last: "1-446", rows: 22, oracle: "g5" },
  highest_mountains: { first: "1-4437", last: "1-10260", rows: 120, oracle: "g30" },
  craigslist_canada: { first: "6-984", last: "6-1117", rows: 55, oracle: "scope-982-g6" },
  hold6_curl_protocols: { first: "0-360", last: "0-435", rows: 16, oracle: "labels-152" },
  hold6_rust_types: { first: "0-583", last: "0-618", rows: 6, oracle: "g10" },
  confirm_nginx_signals: { first: "0-90", last: "0-114", rows: 6, oracle: "g4" },
  hold5_html_tables: { first: "15-544", last: "15-579", rows: 6, oracle: "scope-278-g12" },
  xrates_alphabetical: { first: "6-203", last: "6-720", rows: 50, oracle: "scope-132-g3" },
  hockey_teams: { first: "0-111", last: "0-513", rows: 25, oracle: "g2" },
  hold5_postgres_sections: { first: "0-212", last: "0-236", rows: 9, oracle: "g13" },
  hold5_tld_list: { first: "0-2", last: "0-2", rows: 1436 },
};
