import { API_ROUTES } from "@contexta/shared";
import { apiRequest } from "./client";
import type { UsageResponse } from "@/lib/types";

export const usageApi = {
  get: (): Promise<UsageResponse> =>
    apiRequest(API_ROUTES.usage, { method: "GET" }),
};
