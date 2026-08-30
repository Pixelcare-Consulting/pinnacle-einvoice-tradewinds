export interface Release {
  version: string;
  date: string;
  feature?: string[];
  improvement?: string[];
  fix?: string[];
}

export const releases: Release[] = [
  {
    version: '3.1.8',
    date: '30/08/2026',
    improvement: [
      'Outbound manual invoice table is easier to scan with clearer status labels and better column alignment',
      'Long supplier, receiver, and file names now stay compact in the table instead of stretching rows',
    ],
    fix: [
      'Status and total amount values now line up correctly under their column headers',
    ],
  },
];
