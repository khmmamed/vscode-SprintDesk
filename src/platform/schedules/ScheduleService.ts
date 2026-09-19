import type { Schedule } from "../../runtime/Schedule.js";
import type { ScheduleDefinition, Scheduler } from "../../runtime/Scheduler.js";
import { PlatformError } from "../PlatformError.js";
import type { PipelineService } from "../pipelines/PipelineService.js";
import type { AuthorizationService, Principal } from "../policies/AuthorizationService.js";

export class ScheduleService {
  private readonly scheduler: Scheduler;
  private readonly pipelineService: PipelineService;
  private readonly authorization?: AuthorizationService;

  constructor(
    scheduler: Scheduler,
    pipelineService: PipelineService,
    authorization?: AuthorizationService
  ) {
    this.scheduler = scheduler;
    this.pipelineService = pipelineService;
    this.authorization = authorization;
  }

  create(definition: ScheduleDefinition): Schedule {
    const version = this.pipelineService.requirePublished(definition.pipelineId, definition.version).version;
    return this.scheduler.schedule({ ...definition, version });
  }

  get(id: string): Schedule | undefined {
    return this.scheduler.get(id);
  }

  list(): readonly Schedule[] {
    return this.scheduler.list();
  }

  enable(id: string): Schedule {
    return this.replace(id, true);
  }

  disable(id: string): Schedule {
    return this.replace(id, false);
  }

  delete(id: string): boolean {
    return this.scheduler.unschedule(id);
  }

  trigger(id: string, actor?: Principal | string): string {
    this.authorization?.assertAllowed(actor, "run.start", { type: "run" });
    return this.scheduler.trigger(id);
  }

  private replace(id: string, enabled: boolean): Schedule {
    const schedule = this.scheduler.get(id);
    if (!schedule) {
      throw new PlatformError("INVALID_PLATFORM_OPERATION", `No schedule with id "${id}"`, { scheduleId: id });
    }
    this.scheduler.unschedule(id);
    return this.scheduler.schedule({
      id: schedule.id,
      pipelineId: schedule.pipelineId,
      version: schedule.version,
      trigger: schedule.trigger,
      enabled,
      createdAt: schedule.createdAt,
    });
  }
}