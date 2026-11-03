import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDateString, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

const CATEGORIES = ["auth", "operator", "flight", "settings", "device", "system"];

export class ListActivityQuery {
  @ApiPropertyOptional({ description: "Cari di deskripsi, nama/email pelaku, aksi, IP" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: CATEGORIES })
  @IsOptional()
  @IsIn(CATEGORIES)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  operatorId?: string;

  @ApiPropertyOptional({ enum: ["success", "failed"] })
  @IsOptional()
  @IsIn(["success", "failed"])
  status?: "success" | "failed";

  @ApiPropertyOptional({ example: "2026-11-01T00:00:00.000Z" })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: "2026-11-03T23:59:59.999Z" })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  perPage?: number;
}

export class SummaryActivityQuery {
  @ApiPropertyOptional({ description: "Awal hari ini di zona waktu klien (ISO)" })
  @IsOptional()
  @IsDateString()
  todayStart?: string;
}
