export interface Release {
  version: string;
  date: string;
  feature?: string[];
  improvement?: string[];
  fix?: string[];
}

export const releases: Release[] = [
  {
    version: '3.1.11',
    date: '30/08/2026',
    fix: [
      'Uploaded and invoice date headers on the outbound manual table are easier to read with more space and no overlapping text',
      'Status column uses less empty space around each badge',
    ],
  },
  {
    version: '3.1.10',
    date: '30/08/2026',
    fix: [
      'Uploaded and invoice date column headers on the outbound manual table no longer overlap',
      'Status column no longer leaves extra empty space around status badges',
    ],
  },
  {
    version: '3.1.9',
    date: '30/08/2026',
    improvement: [
      'Supplier, receiver, invoice date, and submitted column titles now show in full on the outbound manual invoice table',
    ],
  },
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
