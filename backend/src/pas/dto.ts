import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export const PAS_STATUSES = ["VALID", "EXPIRED", "NOT_FOUND", "ERROR"] as const;

export class VerifyPasDto {
  @ApiProperty({ example: "https://pas.aptpairport.id/vp/v/025ae001032b7f59045cbd5f" })
  @IsString()
  @MaxLength(512)
  raw!: string;

  @ApiPropertyOptional({ description: "Wajib bila memakai token perangkat" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  operatorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  station?: string;
}

export class ListPasScansQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  station?: string;

  @ApiPropertyOptional({ description: "YYYY-MM-DD (WITA)" })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({ enum: PAS_STATUSES })
  @IsOptional()
  @IsIn(PAS_STATUSES)
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  perPage?: number;
}
