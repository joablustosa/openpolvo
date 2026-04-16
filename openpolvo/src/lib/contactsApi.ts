import { apiUrl } from "./api";

export type ContactDTO = {
  id: string;
  name: string;
  phone: string;
  email: string;
  created_at?: string;
  updated_at?: string;
};

function headersJson(token: string): HeadersInit {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export async function listContacts(token: string): Promise<ContactDTO[]> {
  const res = await fetch(apiUrl("/v1/me/contacts"), {
    headers: headersJson(token),
  });
  if (!res.ok) throw new Error(`contacts: ${res.status}`);
  return res.json() as Promise<ContactDTO[]>;
}

export async function createContact(
  token: string,
  body: { name: string; phone: string; email: string },
): Promise<ContactDTO> {
  const res = await fetch(apiUrl("/v1/me/contacts"), {
    method: "POST",
    headers: headersJson(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`contacts create: ${res.status}`);
  return res.json() as Promise<ContactDTO>;
}

export async function updateContact(
  token: string,
  id: string,
  body: { name: string; phone: string; email: string },
): Promise<void> {
  const res = await fetch(apiUrl(`/v1/me/contacts/${id}`), {
    method: "PUT",
    headers: headersJson(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`contacts update: ${res.status}`);
}

export async function deleteContact(token: string, id: string): Promise<void> {
  const res = await fetch(apiUrl(`/v1/me/contacts/${id}`), {
    method: "DELETE",
    headers: headersJson(token),
  });
  if (!res.ok) throw new Error(`contacts delete: ${res.status}`);
}
