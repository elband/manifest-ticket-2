import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { ActivityLogInterceptor } from "./activity-log.interceptor";
import { ActivityLogsController } from "./activity-logs.controller";
import { ActivityLogsService } from "./activity-logs.service";

@Global()
@Module({
  controllers: [ActivityLogsController],
  providers: [
    ActivityLogsService,
    { provide: APP_INTERCEPTOR, useClass: ActivityLogInterceptor },
  ],
  exports: [ActivityLogsService],
})
export class ActivityLogsModule {}
