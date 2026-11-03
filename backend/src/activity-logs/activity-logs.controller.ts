import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../common/roles.decorator";
import { ActivityLogsService } from "./activity-logs.service";
import { ListActivityQuery, SummaryActivityQuery } from "./dto";

@ApiTags("activity-logs")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin")
@Controller("activity-logs")
export class ActivityLogsController {
  constructor(private svc: ActivityLogsService) {}

  @Get()
  list(@Query() q: ListActivityQuery) {
    return this.svc.list(q);
  }

  @Get("summary")
  summary(@Query() q: SummaryActivityQuery) {
    return this.svc.summary(q);
  }

  @Get("actors")
  actors() {
    return this.svc.actors();
  }
}
