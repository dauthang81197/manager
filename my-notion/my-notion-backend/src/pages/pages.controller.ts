import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import type { JwtPayload } from '../auth/jwt.util';
import { CreatePageDto } from './dto/create-page.dto';
import { RenamePageDto } from './dto/rename-page.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { PagesService } from './pages.service';

function currentOwnerId(req: Request): string {
  return (req as Request & { user: JwtPayload }).user.sub;
}

@Controller('pages')
@UseGuards(JwtGuard)
export class PagesController {
  constructor(private readonly pagesService: PagesService) {}

  @Get('tree')
  getTree(@Req() req: Request) {
    return this.pagesService.getTree(currentOwnerId(req));
  }

  // Declared after 'tree' (a literal segment must be registered before a
  // param route of the same shape, or ':id' would swallow '/pages/tree').
  @Get(':id')
  findOne(@Req() req: Request, @Param('id') id: string) {
    return this.pagesService.findOne(currentOwnerId(req), id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Req() req: Request, @Body() dto: CreatePageDto) {
    return this.pagesService.create(currentOwnerId(req), dto);
  }

  @Patch(':id')
  rename(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: RenamePageDto,
  ) {
    return this.pagesService.rename(currentOwnerId(req), id, dto);
  }

  @Patch(':id/content')
  updateContent(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateContentDto,
  ) {
    return this.pagesService.updateContent(currentOwnerId(req), id, dto);
  }

  @Get(':id/descendants-count')
  async getDescendantsCount(@Req() req: Request, @Param('id') id: string) {
    const count = await this.pagesService.countDescendants(
      currentOwnerId(req),
      id,
    );
    return { count };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: Request, @Param('id') id: string): Promise<void> {
    await this.pagesService.remove(currentOwnerId(req), id);
  }
}
