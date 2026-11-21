import { API_ROUTES } from "@contexta/shared";
import { apiRequest } from "./client";
import type { Provider, ProviderKeyBody } from "@/lib/types";

export const settingsApi = {
  setProviderKey: (data: ProviderKeyBody): Promise<void> =>
    apiRequest(API_ROUTES.settings.providerKey, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteProviderKey: (provider: Provider): Promise<void> =>
    apiRequest(`${API_ROUTES.settings.providerKey}?provider=${encodeURIComponent(provider)}`, {
      method: "DELETE",
    }),
  listProviderKeys: (): Promise<ProviderKeyBody[]> =>
    apiRequest(API_ROUTES.settings.providerKey, { method: "GET" }),
};
