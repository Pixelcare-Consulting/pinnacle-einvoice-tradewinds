/** Grid list fields — document/documentDetails used server-side for export fields only, then stripped. */
const INBOUND_LIST_SELECT = {
  uuid: true,
  submissionUid: true,
  longId: true,
  internalId: true,
  typeName: true,
  typeVersionName: true,
  issuerTin: true,
  issuerName: true,
  receiverId: true,
  receiverName: true,
  dateTimeReceived: true,
  dateTimeValidated: true,
  status: true,
  documentStatusReason: true,
  cancelDateTime: true,
  rejectRequestDateTime: true,
  createdByUserId: true,
  dateTimeIssued: true,
  totalSales: true,
  totalExcludingTax: true,
  totalDiscount: true,
  totalNetAmount: true,
  totalPayableAmount: true,
  documentCurrency: true,
  last_sync_date: true,
  sync_status: true,
  created_at: true,
  updated_at: true,
  documentDetails: true,
  document: true,
};

const INBOUND_ORDER_COLUMN_MAP = {
  2: "uuid",
  3: "longId",
  4: "internalId",
  5: "issuerName",
  6: "receiverName",
  7: "dateTimeReceived",
  8: "status",
  9: "totalSales",
};

const QUEUE_STATUSES = ["Submitted", "Processing", "Pending", "Queued"];

function parseInboundListParams(req) {
  const q = req.query || {};
  const start = Math.max(0, parseInt(q.start, 10) || 0);
  const lengthRaw = parseInt(q.length, 10);
  const length = Number.isFinite(lengthRaw) && lengthRaw > 0 ? lengthRaw : 10;

  const searchValue =
    (typeof q["search[value]"] === "string" && q["search[value]"]) ||
    (q.search && typeof q.search === "object" && q.search.value) ||
    (typeof q.search === "string" ? q.search : "") ||
    "";

  const statusFilter = (q.statusFilter || "all").toLowerCase();

  const orderCol = parseInt(q["order[0][column]"] ?? q.orderColumn, 10);
  const orderDir =
    (q["order[0][dir]"] || q.orderDir || "desc").toLowerCase() === "asc"
      ? "asc"
      : "desc";
  const orderField =
    INBOUND_ORDER_COLUMN_MAP[orderCol] || "dateTimeReceived";

  return {
    start,
    length,
    searchValue: searchValue.trim(),
    statusFilter,
    orderBy: { [orderField]: orderDir },
    dateFrom: q.dateFrom || "",
    dateTo: q.dateTo || "",
    minAmount: q.minAmount !== undefined && q.minAmount !== "" ? parseFloat(q.minAmount) : null,
    maxAmount: q.maxAmount !== undefined && q.maxAmount !== "" ? parseFloat(q.maxAmount) : null,
    companyFilter: (q.companyFilter || "").trim(),
    typeFilter: (q.typeFilter || "").trim(),
    syncRequestId: q.syncRequestId || null,
  };
}

function buildInboundListWhere(params) {
  const and = [];

  if (params.searchValue) {
    const term = params.searchValue;
    and.push({
      OR: [
        { uuid: { contains: term } },
        { internalId: { contains: term } },
        { issuerName: { contains: term } },
        { receiverName: { contains: term } },
        { status: { contains: term } },
      ],
    });
  }

  switch (params.statusFilter) {
    case "valid":
      and.push({ status: "Valid" });
      break;
    case "invalid":
      and.push({ status: "Invalid" });
      break;
    case "cancelled":
      and.push({ status: "Cancelled" });
      break;
    case "queue":
      and.push({ status: { in: QUEUE_STATUSES } });
      break;
    case "all":
    default:
      break;
  }

  if (params.companyFilter) {
    and.push({
      OR: [
        { issuerName: { contains: params.companyFilter } },
        { receiverName: { contains: params.companyFilter } },
      ],
    });
  }

  if (params.typeFilter) {
    and.push({ typeName: { contains: params.typeFilter } });
  }

  if (params.minAmount !== null && !Number.isNaN(params.minAmount)) {
    and.push({ totalSales: { gte: params.minAmount } });
  }

  if (params.maxAmount !== null && !Number.isNaN(params.maxAmount)) {
    and.push({ totalSales: { lte: params.maxAmount } });
  }

  if (params.dateFrom) {
    and.push({ dateTimeReceived: { gte: params.dateFrom } });
  }

  if (params.dateTo) {
    and.push({ dateTimeReceived: { lte: `${params.dateTo}T23:59:59` } });
  }

  return and.length > 0 ? { AND: and } : {};
}

function wantsInboundPagination(req) {
  const q = req.query || {};
  if (q.start !== undefined || q.length !== undefined) {
    return true;
  }
  // Inbound grid always uses paged DB reads (avoid loading full WP_INBOUND_STATUS).
  if (q.useDatabase === "true" || q.fallbackOnly === "true") {
    return true;
  }
  return false;
}

function summarizeInboundStatusGroups(groups) {
  const summary = {
    invoices: 0,
    valid: 0,
    invalid: 0,
    cancelled: 0,
    rejected: 0,
    submitted: 0,
    queue: 0,
  };

  for (const row of groups || []) {
    const count = row._count?.status ?? row.count ?? 0;
    const status = (row.status || "").trim();
    summary.invoices += count;

    switch (status) {
      case "Valid":
        summary.valid += count;
        break;
      case "Invalid":
        summary.invalid += count;
        break;
      case "Cancelled":
        summary.cancelled += count;
        break;
      case "Rejected":
        summary.rejected += count;
        break;
      default:
        break;
    }

    if (QUEUE_STATUSES.includes(status)) {
      summary.queue += count;
    }
  }

  return summary;
}

module.exports = {
  INBOUND_LIST_SELECT,
  INBOUND_ORDER_COLUMN_MAP,
  QUEUE_STATUSES,
  parseInboundListParams,
  buildInboundListWhere,
  wantsInboundPagination,
  summarizeInboundStatusGroups,
};
