import { Module } from "@nestjs/common";
import { PasController } from "./pas.controller";
import { PasService } from "./pas.service";

@Module({
  controllers: [PasController],
  providers: [PasService],
})
export class PasModule {}
