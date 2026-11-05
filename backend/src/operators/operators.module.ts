import { Module } from "@nestjs/common";
import { OperatorsController } from "./operators.controller";
import { OperatorsService } from "./operators.service";
import { ProfileController } from "./profile.controller";

@Module({
  controllers: [OperatorsController, ProfileController],
  providers: [OperatorsService],
  exports: [OperatorsService],
})
export class OperatorsModule {}
