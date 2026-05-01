import { fetchApi } from "./api";

function headersJson(token: string): HeadersInit {
  const t = token.trim();
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${t}`,
  };
}

export type DigestSettingsDTO = {
  user_id: string;
  timezone: string;
  digest_hour: number;
  digest_enabled: boolean;
  include_finance_summary: boolean;
  include_tasks: boolean;
  last_digest_sent_on?: string | null;
  updated_at: string;
};

export type AgendaEventDTO = {
  type: string;
  id: string;
  title: string;
  starts_at: string;
  ends_at?: string | null;
  payload?: Record<string, unknown>;
};

export type CategoryDTO = {
  id: string;
  user_id: string;
  name: string;
  sort_order: number;
  parent_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type TransactionDTO = {
  id: string;
  user_id: string;
  amount_minor: number;
  currency: string;
  direction: "in" | "out";
  description: string;
  source: string;
  occurred_at: string;
  created_at: string;
  category_id?: string | null;
  subcategory_id?: string | null;
};

export type SubscriptionDTO = {
  id: string;
  user_id: string;
  name: string;
  amount_minor: number;
  currency: string;
  cadence: string;
  anchor_day?: number | null;
  next_due_at: string;
  status: string;
  reminder_active: boolean;
  last_paid_at?: string | null;
  last_reminder_sent_at?: string | null;
  created_at: string;
  updated_at: string;
};

export async function getDigestSettings(token: string): Promise<DigestSettingsDTO> {
  const res = await fetchApi("/v1/me/digest-settings", {
    headers: headersJson(token),
  });
  if (!res.ok) throw new Error(`digest-settings: ${res.status}`);
  return res.json() as Promise<DigestSettingsDTO>;
}

export type PutDigestSettingsBody = {
  timezone: string;
  digest_hour?: number;
  digest_enabled?: boolean;
  include_finance_summary?: boolean;
  include_tasks?: boolean;
};

export async function putDigestSettings(
  token: string,
  body: PutDigestSettingsBody,
): Promise<DigestSettingsDTO> {
  const res = await fetchApi("/v1/me/digest-settings", {
    method: "PUT",
    headers: headersJson(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`digest-settings put: ${res.status}`);
  return res.json() as Promise<DigestSettingsDTO>;
}

export async function getAgenda(
  token: string,
  from: string,
  to: string,
): Promise<{ events: AgendaEventDTO[] }> {
  const q = new URLSearchParams({ from, to });
  const res = await fetchApi(`/v1/agenda?${q.toString()}`, {
    headers: headersJson(token),
  });
  if (!res.ok) throw new Error(`agenda: ${res.status}`);
  return res.json() as Promise<{ events: AgendaEventDTO[] }>;
}

export async function getCategories(token: string): Promise<CategoryDTO[]> {
  const res = await fetchApi("/v1/finance/categories", {
    headers: headersJson(token),
  });
  if (!res.ok) throw new Error(`finance categories: ${res.status}`);
  return res.json() as Promise<CategoryDTO[]>;
}

export async function postCategory(
  token: string,
  body: { name: string; parent_id?: string | null; sort_order?: number },
): Promise<CategoryDTO> {
  const res = await fetchApi("/v1/finance/categories", {
    method: "POST",
    headers: headersJson(token),
    body: JSON.stringify({
      name: body.name,
      parent_id: body.parent_id ?? null,
      sort_order: body.sort_order ?? 0,
    }),
  });
  if (!res.ok) throw new Error(`finance category create: ${res.status}`);
  return res.json() as Promise<CategoryDTO>;
}

export async function deleteCategory(token: string, id: string): Promise<void> {
  const res = await fetchApi(`/v1/finance/categories/${id}`, {
    method: "DELETE",
    headers: headersJson(token),
  });
  if (!res.ok) throw new Error(`finance category delete: ${res.status}`);
}

export async function getTransactions(
  token: string,
  from: string,
  to: string,
  direction?: "in" | "out",
): Promise<TransactionDTO[]> {
  const q = new URLSearchParams({ from, to });
  if (direction) q.set("direction", direction);
  const res = await fetchApi(`/v1/finance/transactions?${q.toString()}`, {
    headers: headersJson(token),
  });
  if (!res.ok) throw new Error(`finance transactions: ${res.status}`);
  return res.json() as Promise<TransactionDTO[]>;
}

export async function postTransaction(
  token: string,
  body: {
    amount_minor: number;
    currency?: string;
    direction: "in" | "out";
    occurred_at: string;
    description?: string;
    category_id?: string | null;
    subcategory_id?: string | null;
    source?: string;
  },
): Promise<TransactionDTO> {
  const res = await fetchApi("/v1/finance/transactions", {
    method: "POST",
    headers: headersJson(token),
    body: JSON.stringify({
      amount_minor: body.amount_minor,
      currency: body.currency ?? "EUR",
      direction: body.direction,
      occurred_at: body.occurred_at,
      description: body.description ?? "",
      category_id: body.category_id ?? null,
      subcategory_id: body.subcategory_id ?? null,
      source: body.source ?? "manual",
    }),
  });
  if (!res.ok) throw new Error(`finance transaction create: ${res.status}`);
  return res.json() as Promise<TransactionDTO>;
}

export async function deleteTransaction(token: string, id: string): Promise<void> {
  const res = await fetchApi(`/v1/finance/transactions/${id}`, {
    method: "DELETE",
    headers: headersJson(token),
  });
  if (!res.ok) throw new Error(`finance transaction delete: ${res.status}`);
}

export async function patchTransaction(
  token: string,
  id: string,
  body: {
    category_id?: string | null;
    subcategory_id?: string | null;
    description?: string | null;
  },
): Promise<TransactionDTO> {
  const res = await fetchApi(`/v1/finance/transactions/${id}`, {
    method: "PATCH",
    headers: headersJson(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`finance transaction patch: ${res.status}`);
  return res.json() as Promise<TransactionDTO>;
}

export async function getSubscriptions(token: string): Promise<SubscriptionDTO[]> {
  const res = await fetchApi("/v1/finance/subscriptions", {
    headers: headersJson(token),
  });
  if (!res.ok) throw new Error(`finance subscriptions: ${res.status}`);
  return res.json() as Promise<SubscriptionDTO[]>;
}

export async function postSubscription(
  token: string,
  body: {
    name: string;
    amount_minor: number;
    currency?: string;
    cadence: string;
    anchor_day?: number | null;
    next_due_at: string;
  },
): Promise<SubscriptionDTO> {
  const res = await fetchApi("/v1/finance/subscriptions", {
    method: "POST",
    headers: headersJson(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`finance subscription create: ${res.status}`);
  return res.json() as Promise<SubscriptionDTO>;
}

export async function patchSubscription(
  token: string,
  id: string,
  body: Partial<{
    name: string;
    amount_minor: number;
    currency: string;
    cadence: string;
    next_due_at: string;
    status: string;
    reminder_active: boolean;
  }>,
): Promise<SubscriptionDTO> {
  const res = await fetchApi(`/v1/finance/subscriptions/${id}`, {
    method: "PATCH",
    headers: headersJson(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`finance subscription patch: ${res.status}`);
  return res.json() as Promise<SubscriptionDTO>;
}

export async function postSubscriptionPaid(
  token: string,
  id: string,
): Promise<SubscriptionDTO> {
  const res = await fetchApi(`/v1/finance/subscriptions/${id}/paid`, {
    method: "POST",
    headers: headersJson(token),
  });
  if (!res.ok) throw new Error(`finance subscription paid: ${res.status}`);
  return res.json() as Promise<SubscriptionDTO>;
}

export async function deleteSubscription(token: string, id: string): Promise<void> {
  const res = await fetchApi(`/v1/finance/subscriptions/${id}`, {
    method: "DELETE",
    headers: headersJson(token),
  });
  if (!res.ok) throw new Error(`finance subscription delete: ${res.status}`);
}
