import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from 'src/admin/admin.service';
import { AdminOnlyGuard } from 'src/admin/role.guard';

import { AdminActivitiesQueryDto, UpdateBugReportDto } from 'src/schema/admin';
import { IdParamsDto } from 'src/schema/common';
import { AdminUpdateUserDto } from 'src/schema/user';

@Controller('admin')
@UseGuards(AdminOnlyGuard)
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get('groups')
  getGroups() {
    return this.adminService.getGroups();
  }

  @Get('activites')
  getActivity(@Query() query: AdminActivitiesQueryDto) {
    return this.adminService.getActivities(query);
  }

  @Get('users')
  getUsers() {
    return this.adminService.getUsers();
  }

  @Patch('users/:id')
  updateUser(
    @Param() { id }: IdParamsDto,
    @Body() { password }: AdminUpdateUserDto,
  ) {
    return this.adminService.updateUser(id, password);
  }

  @Delete('users/:id')
  deleteUser(@Param() { id }: IdParamsDto) {
    return this.adminService.deleteUser(id);
  }

  @Get('bugs')
  getBugReports() {
    return this.adminService.getBugs();
  }

  @Patch('bugs/:id')
  updateBugReport(
    @Param() { id }: IdParamsDto,
    @Body() { status, severity }: UpdateBugReportDto,
  ) {
    return this.adminService.updateBugReport(id, status, severity);
  }

  @Delete('bugs/:id')
  deleteBugReports(@Param() { id }: IdParamsDto) {
    return this.adminService.deleteBugReport(id);
  }
}
