import { ApiProperty } from "@nestjs/swagger";
import { IsObject } from "class-validator";

export class UpdateAppSettingsDto {
  @ApiProperty({ example: { kioskResultDurationSec: 0, soundOn: true } })
  @IsObject()
  data!: Record<string, unknown>;
}
