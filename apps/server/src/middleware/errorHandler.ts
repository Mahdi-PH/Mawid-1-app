import type { NextFunction, Request, Response } from "express";
import { SlotNotAvailableError } from "@mawid/shared";
import { SlotTakenError } from "../modules/appointments/appointments.service";

/** Central error -> HTTP status mapping so route handlers can just `throw`. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof SlotTakenError) {
    return res.status(409).json({ error: "SLOT_TAKEN", message: err.message });
  }
  if (err instanceof SlotNotAvailableError) {
    return res.status(422).json({ error: "SLOT_NOT_AVAILABLE", message: err.message });
  }
  if (err && typeof err === "object" && "issues" in err) {
    // zod validation error
    return res.status(400).json({ error: "VALIDATION_ERROR", details: (err as any).issues });
  }

  console.error(err);
  return res.status(500).json({ error: "INTERNAL_ERROR" });
}

/** Wraps an async route handler so a rejected promise reaches errorHandler. */
export function asyncRoute(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
